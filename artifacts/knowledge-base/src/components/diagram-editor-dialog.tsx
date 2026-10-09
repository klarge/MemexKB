import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Download, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  EMPTY_DIAGRAM_XML, dataUriToBytes, downloadDrawio, downloadPng,
  fetchLocalDiagramPng, parseDiagramPng,
} from "@/lib/diagram-png";

const EDITOR_URL = "/api/diagram-editor/index.html?embed=1&proto=json&offline=1&local=1&lockdown=1&plugins=0&libraries=1&libs=general%3Bflowchart%3Bbasic%3Barrows2%3Buml&lang=en&configure=1&spin=1";
const MAX_MESSAGE = 24 * 1024 * 1024;
const EXPORT_TIMEOUT_MS = 45_000;

const CONFIG = {
  defaultFonts: ["Arial", "Helvetica", "Times New Roman", "Courier New"], customFonts: [],
  enableCustomLibraries: false, plugins: [], fontCss: "",
  compressXml: false, autosave: true,
};

type Purpose = "apply" | "png" | "drawio";
type Phase = "source" | "loading" | "ready" | "exporting" | "uploading";

export interface DiagramEditorDialogProps {
  open: boolean;
  /** Existing local image src to edit, or null for a new diagram. */
  source: string | null;
  onClose: () => void;
  /** Called with the uploaded image URL. Host replaces/inserts the node. */
  onApply: (url: string) => void;
}

export function DiagramEditorDialog({ open, source, onClose, onApply }: DiagramEditorDialogProps) {
  return open ? <DiagramEditorBody source={source} onClose={onClose} onApply={onApply} /> : null;
}

function DiagramEditorBody({ source, onClose, onApply }: Omit<DiagramEditorDialogProps, "open">) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [phase, setPhase] = useState<Phase>("source");
  const phaseRef = useRef<Phase>("source");
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [initialXml, setInitialXml] = useState<string | null>(null);
  const purposeRef = useRef<Purpose | null>(null);
  const exportIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyOverlayRef = useRef<HTMLDivElement | null>(null);
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  const go = (p: Phase) => { phaseRef.current = p; setPhase(p); };
  const post = useCallback((msg: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify(msg), "*");
  }, []);
  const clearTimer = () => { if (timerRef.current) clearTimeout(timerRef.current); timerRef.current = null; };

  // Resolve the initial XML (source PNG data URI or empty mxfile) before mounting the iframe.
  useEffect(() => {
    let cancelled = false;
    setError(null); go("source"); setInitialXml(null);
    (async () => {
      if (!source) { if (!cancelled) { setInitialXml(EMPTY_DIAGRAM_XML); go("loading"); } return; }
      try {
        const bytes = await fetchLocalDiagramPng(source);
        const parsed = await parseDiagramPng(bytes);
        if (!parsed.xml) throw new Error("This image has no embedded diagram source, so it cannot be edited.");
        if (!cancelled) { setInitialXml(parsed.xml); go("loading"); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the diagram.");
      }
    })();
    return () => { cancelled = true; };
  }, [source, attempt]);

  const requestExport = useCallback((purpose: Purpose) => {
    if (phaseRef.current !== "ready") return;
    purposeRef.current = purpose;
    setError(null);
    go("exporting");
    post({ action: "export", format: "xmlpng", scale: 2, border: 10, requestId: ++exportIdRef.current });
    clearTimer();
    timerRef.current = setTimeout(() => {
      if (phaseRef.current === "exporting") {
        purposeRef.current = null;
        go("ready");
        setError("The editor did not respond to the export request. Try again.");
      }
    }, EXPORT_TIMEOUT_MS);
  }, [post]);
  const requestExportRef = useRef(requestExport);
  requestExportRef.current = requestExport;

  const requestClose = useCallback(() => {
    if (phaseRef.current === "exporting" || phaseRef.current === "uploading") return;
    if (dirtyRef.current && !window.confirm("Discard unsaved changes to this diagram?")) return;
    clearTimer();
    onClose();
  }, [onClose]);
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  const upload = async (bytes: Uint8Array) => {
    go("uploading");
    try {
      const form = new FormData();
      form.append("file", new File([bytes as BlobPart], "diagram.png", { type: "image/png" }));
      const res = await fetch("/api/articles/images", {
        method: "POST", body: form, credentials: "include", signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const details = await res.json().catch(() => ({})) as { error?: unknown };
        throw new Error(typeof details.error === "string" ? details.error : `Upload failed (${res.status}).`);
      }
      const data = (await res.json()) as { url?: unknown };
      if (typeof data.url !== "string" || !/^\/api\/articles\/images\/\d+$/.test(data.url)) throw new Error("Upload returned an unexpected response.");
      dirtyRef.current = false;
      onApplyRef.current(data.url);
    } catch (e) {
      go("ready");
      setError(`${e instanceof Error ? e.message : "Upload failed."} Your diagram is still open; try again.`);
    }
  };

  const handleExport = async (data: unknown) => {
    const purpose = purposeRef.current;
    purposeRef.current = null;
    clearTimer();
    try {
      const bytes = dataUriToBytes(data as string);
      const parsed = await parseDiagramPng(bytes);
      if (!parsed.xml) throw new Error("Export did not include diagram source.");
      if (purpose === "png") { downloadPng(bytes); go("ready"); }
      else if (purpose === "drawio") { downloadDrawio(parsed.xml); go("ready"); }
      else if (purpose === "apply") await upload(bytes);
      else go("ready");
    } catch (e) {
      go("ready");
      setError(`${e instanceof Error ? e.message : "Export failed."} Try again.`);
    }
  };
  const handleExportRef = useRef(handleExport);
  handleExportRef.current = handleExport;

  useEffect(() => {
    if (initialXml === null) return;
    const listener = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow || (event.origin as string) !== "null") return;
      if (typeof event.data !== "string" || event.data.length > MAX_MESSAGE) return;
      let msg: { event?: unknown; data?: unknown; message?: { requestId?: unknown } };
      try { msg = JSON.parse(event.data); } catch { return; }
      if (!msg || typeof msg !== "object" || typeof msg.event !== "string") return;
      const ph = phaseRef.current;
      switch (msg.event) {
        case "configure":
          if (ph === "loading") post({ action: "configure", config: CONFIG });
          break;
        case "init":
          if (ph === "loading") post({ action: "load", xml: initialXml, autosave: 1 });
          break;
        case "load":
          if (ph === "loading") go("ready");
          break;
        case "autosave":
          if (ph === "ready") { dirtyRef.current = true; setDirty(true); }
          break;
        case "save":
          if (ph === "ready") { dirtyRef.current = true; setDirty(true); requestExportRef.current("apply"); }
          break;
        case "export":
          if (ph === "exporting" && purposeRef.current && msg.message?.requestId === exportIdRef.current) {
            void handleExportRef.current(msg.data);
          }
          break;
        case "exit":
          requestCloseRef.current();
          break;
      }
    };
    window.addEventListener("message", listener);
    return () => { window.removeEventListener("message", listener); clearTimer(); };
  }, [initialXml, post]);

  // A missing/blocked vendor asset should not leave an endless loading screen.
  useEffect(() => {
    if (phase !== "loading") return;
    const timeout = setTimeout(() => {
      go("source");
      setError("The local editor could not load. Check the connection and try again.");
    }, 30_000);
    return () => clearTimeout(timeout);
  }, [phase]);

  const busy = phase === "exporting" || phase === "uploading";
  const ready = phase === "ready";
  const isEdit = Boolean(source);
  useEffect(() => {
    if (busy) busyOverlayRef.current?.focus();
  }, [busy]);

  return (
    <Dialog open onOpenChange={(next) => { if (!next) requestClose(); }}>
    <DialogContent
      className="flex h-[92dvh] max-w-[min(96vw,1280px)] flex-col gap-3 p-4"
      onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
      onInteractOutside={(e) => e.preventDefault()}
      onPointerDownOutside={(e) => e.preventDefault()}
    >
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit diagram" : "Insert diagram"}</DialogTitle>
        <DialogDescription>Drawn locally in a sandboxed editor. Nothing is applied to the article until you use the button below.</DialogDescription>
      </DialogHeader>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
        {initialXml !== null && (
          <iframe
            key={attempt}
            ref={iframeRef}
            title="Diagram editor"
            src={EDITOR_URL}
            sandbox="allow-scripts allow-downloads"
            referrerPolicy="no-referrer"
            inert={busy}
            className="h-full w-full border-0"
            data-testid="iframe-diagram-editor"
          />
        )}
        {busy && (
          <div ref={busyOverlayRef} tabIndex={-1} role="status" aria-live="polite"
            className="absolute inset-0 flex items-center justify-center bg-card/70 text-sm outline-none">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {phase === "uploading" ? "Saving diagram…" : "Preparing diagram…"}
          </div>
        )}
        {(phase === "source" || phase === "loading") && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading diagram editor…
          </div>
        )}
        {phase === "source" && error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card p-6 text-center text-sm">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="max-w-md text-destructive" data-testid="text-diagram-load-error">{error}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setAttempt((a) => a + 1)} data-testid="button-diagram-retry-load">Retry</Button>
              <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
            </div>
          </div>
        )}
      </div>
      {error && phase !== "source" && (
        <p className="text-sm text-destructive" role="alert" data-testid="text-diagram-error">{error}</p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!ready} onClick={() => requestExport("png")} data-testid="button-diagram-download-png">
          <Download className="mr-1.5 h-3.5 w-3.5" /> PNG
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!ready} onClick={() => requestExport("drawio")} data-testid="button-diagram-download-drawio">
          <Download className="mr-1.5 h-3.5 w-3.5" /> .drawio
        </Button>
        <div className="flex-1" />
        <Button type="button" variant="outline" disabled={busy} onClick={requestClose} data-testid="button-diagram-cancel">
          {dirty ? "Discard" : "Cancel"}
        </Button>
        <Button type="button" disabled={!ready} onClick={() => requestExport("apply")} data-testid="button-diagram-apply">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEdit ? "Update diagram" : "Insert diagram"}
        </Button>
      </div>
    </DialogContent>
    </Dialog>
  );
}
