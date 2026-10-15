import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminMedia,
  getListAdminMediaQueryKey,
  usePreviewAdminMediaCleanup,
  useCleanupAdminMedia,
  type AdminMediaImage,
  type AdminMediaCleanupPreview,
  type AdminMediaCleanupResult,
  type ListAdminMediaParams,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { LoadMore } from "@/components/load-more";
import { CONTENT_PAGE_SIZE as PAGE_SIZE } from "@/hooks/use-visible-items";
import { AlertCircle, RefreshCw, Wrench, ImageIcon, Loader2, Trash2, Search, Info } from "lucide-react";
import { format } from "date-fns";

type StatusFilter = NonNullable<ListAdminMediaParams["status"]>;
const CONFIRM_PHRASE = "DELETE UNUSED MEDIA" as const;

const STATUS_META: Record<AdminMediaImage["status"], { label: string; className: string; hint: string }> = {
  current: { label: "In use", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", hint: "Referenced by saved content" },
  history: { label: "History only", className: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30", hint: "Referenced only by older versions" },
  recent: { label: "Recent", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30", hint: "Unreferenced, within grace period" },
  unused: { label: "Unused", className: "bg-destructive/10 text-destructive border-destructive/30", hint: "Unreferenced, eligible for cleanup" },
};

function errorMessage(e: unknown, fallback: string) {
  const d = (e as { data?: { error?: unknown } } | null)?.data;
  return d && typeof d.error === "string" && d.error ? d.error : fallback;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function Stat({ label, value, sub, testId }: { label: string; value: string | number; sub?: string; testId: string }) {
  return (
    <Card>
      <CardContent className="p-4" data-testid={testId}>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function MediaCard({ img }: { img: AdminMediaImage }) {
  const meta = STATUS_META[img.status];
  const [broken, setBroken] = useState(false);
  return (
    <Card className="min-w-0" data-testid={`media-item-${img.id}`}>
      <CardContent className="min-w-0 p-3 flex gap-3">
        <div className="h-20 w-20 shrink-0 rounded-md border border-border bg-muted flex items-center justify-center overflow-hidden">
          {broken ? <ImageIcon className="h-6 w-6 text-muted-foreground" /> : (
            <img src={`/api/articles/images/${img.id}`} alt={img.filename} loading="lazy"
              className="h-full w-full object-cover" onError={() => setBroken(true)} />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium truncate text-sm" title={img.filename}>{img.filename}</p>
            <Badge variant="outline" title={meta.hint} className={`shrink-0 ${meta.className}`}>{meta.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {img.mimeType} - {formatBytes(img.sizeBytes)} original, {formatBytes(img.storedBytes)} stored
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {format(new Date(img.createdAt), "MMM d, yyyy")} by {img.uploadedByName ?? "unknown"}
          </p>
          <p className="text-xs text-muted-foreground">
            {img.currentReferences} current, {img.historyReferences} history references
          </p>
          {img.articleTitle && (
            <p className="text-xs truncate">
              Uploaded in{" "}
              {img.articleTitle}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminMaintenance() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [pages, setPages] = useState<{ key: string; byOffset: Record<number, AdminMediaImage[]> }>({ key: "", byOffset: {} });
  const filterKey = `${status}|${search}|${epoch}`;

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setOffset(0); }, [status, search]);

  const params: ListAdminMediaParams = { status, ...(search ? { search } : {}), offset, limit: PAGE_SIZE };
  const { data, isLoading, isError, refetch, isFetching } = useListAdminMedia(params, {
    query: {
      queryKey: getListAdminMediaQueryKey(params),
      staleTime: 30_000,
    },
  });

  // Each response is stored by its own offset, only while its filters are still current.
  useEffect(() => {
    if (!data) return;
    setPages((p) => {
      const base = p.key === filterKey ? p.byOffset : {};
      return { key: filterKey, byOffset: { ...base, [offset]: data.images } };
    });
  }, [data, offset, filterKey]);

  const totalRef = useRef(0);
  if (data && pages.key === filterKey) totalRef.current = data.total;
  const total = data ? data.total : pages.key === filterKey ? totalRef.current : 0;

  const resetPagination = () => {
    setOffset(0);
    setEpoch((e) => e + 1);
    setPages({ key: "", byOffset: {} });
  };
  const refresh = () => {
    resetPagination();
    queryClient.invalidateQueries({ queryKey: [`/api/admin/media`] });
  };

  const previewMutation = usePreviewAdminMediaCleanup();
  const cleanupMutation = useCleanupAdminMedia();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [preview, setPreview] = useState<AdminMediaCleanupPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [result, setResult] = useState<AdminMediaCleanupResult | null>(null);
  const [typed, setTyped] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!preview) return;
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [preview]);

  const summary = data?.summary;
  const images = (() => {
    if (pages.key !== filterKey) return [] as AdminMediaImage[];
    const seen = new Set<number>();
    return Object.keys(pages.byOffset).map(Number).sort((x, y) => x - y)
      .flatMap((o) => pages.byOffset[o]).filter((i) => !seen.has(i.id) && seen.add(i.id));
  })();
  const loadedFirst = images.length > 0;
  const grace = summary?.gracePeriodDays ?? preview?.gracePeriodDays ?? 7;
  const expired = preview ? new Date(preview.expiresAt).getTime() <= now : false;
  const needsNewPreview = expired || !!cleanupError || !!previewError;

  const startPreview = () => {
    setDialogOpen(true);
    setPreview(null);
    setResult(null);
    setPreviewError(null);
    setCleanupError(null);
    setTyped("");
    setNow(Date.now());
    previewMutation.mutate(undefined, {
      onSuccess: (p) => { setPreview(p); setNow(Date.now()); },
      onError: (e) => setPreviewError(errorMessage(e, "Could not prepare the preview.")),
    });
  };

  const closeDialog = () => {
    if (cleanupMutation.isPending) return;
    setDialogOpen(false);
    setPreview(null);
    setTyped("");
  };

  const runCleanup = () => {
    if (!preview || preview.count <= 0 || expired || typed !== CONFIRM_PHRASE) return;
    cleanupMutation.mutate(
      { data: { previewId: preview.previewId, confirmation: CONFIRM_PHRASE } },
      {
        onSuccess: (r) => {
          setResult(r);
          setPreview(null);
          setTyped("");
          resetPagination();
          queryClient.invalidateQueries({ queryKey: [`/api/admin/media`] });
        },
        onError: (e) => {
          setCleanupError(errorMessage(e, "Cleanup failed."));
          setPreview(null);
          setTyped("");
        },
      },
    );
  };

  const pending = previewMutation.isPending;
  const canDelete = !!preview && preview.count > 0 && !expired && typed === CONFIRM_PHRASE && !cleanupMutation.isPending;

  return (
    <div className="min-w-0 w-full space-y-6" data-testid="page-admin-maintenance">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wrench className="h-6 w-6" />
            Maintenance
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Understand stored images and remove the ones nothing refers to.
          </p>
        </div>
        <Button className="max-w-full h-auto min-h-9 whitespace-normal py-2" onClick={startPreview} disabled={pending} data-testid="button-cleanup-preview">
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
          Preview unused media cleanup
        </Button>
      </div>

      <section className="space-y-4" data-testid="section-media-maintenance">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Media maintenance</h2>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isFetching} data-testid="button-media-refresh">
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="flex gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="text-muted-foreground space-y-1">
            <p>
              Cleanup only considers images that nothing saved refers to and that are older than {grace} days.
              Images referenced by current articles, templates, procedures, policies, logs or project documents, or by
              any saved version history, are always kept so older versions can still be recovered. Referenced images cannot be deleted by hand.
            </p>
            <p>
              Local unsaved drafts that are older than the grace window cannot be seen by the server; an image used only
              there could be removed. Take a backup before deleting.
            </p>
          </div>
        </div>

        {summary ? (
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat testId="stat-total" label="All images" value={summary.total} sub={`${formatBytes(summary.totalBytes)} stored`} />
            <Stat testId="stat-current" label="In use" value={summary.current} sub={`${summary.history} history only`} />
            <Stat testId="stat-recent" label="Recent, unreferenced" value={summary.recent} sub={`under ${summary.gracePeriodDays} days old`} />
            <Stat testId="stat-unused" label="Unused" value={summary.unused} sub={`${formatBytes(summary.unusedBytes)} reclaimable`} />
          </div>
        ) : isLoading ? (
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : null}

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by filename"
              maxLength={200}
              className="pl-9"
              aria-label="Search by filename"
              data-testid="input-media-search"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="sm:w-52" aria-label="Filter by status" data-testid="select-media-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="current">In use</SelectItem>
              <SelectItem value="history">History only</SelectItem>
              <SelectItem value="recent">Recent</SelectItem>
              <SelectItem value="unused">Unused</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!loadedFirst && (isLoading || (isFetching && !isError)) ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="media-loading">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : !loadedFirst && isError ? (
          <Card>
            <CardContent className="p-10 text-center space-y-3" data-testid="media-error">
              <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
              <p className="text-muted-foreground">Could not load images.</p>
              <Button variant="outline" onClick={() => refetch()}>Try again</Button>
            </CardContent>
          </Card>
        ) : !loadedFirst ? (
          <Card>
            <CardContent className="p-12 text-center" data-testid="media-empty">
              <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">
                {status !== "all" || search ? "No images match these filters." : "No images have been uploaded yet."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-xs text-muted-foreground" data-testid="media-count">
              Showing {images.length} of {total || images.length}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="media-list">
              {images.map((img) => <MediaCard key={img.id} img={img} />)}
              <div className="col-span-full" data-testid="media-load-more">
              <LoadMore
                hasMore={offset + PAGE_SIZE < total || (isError && offset > 0)}
                loading={isFetching && !data}
                error={isError && offset > 0}
                onClick={() => (isError ? refetch() : setOffset((o) => o + PAGE_SIZE))}
              />
              </div>
            </div>
          </>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent data-testid="dialog-cleanup">
          <DialogHeader>
            <DialogTitle>Delete unused media</DialogTitle>
            <DialogDescription>
              Covers every unused image in the library, regardless of the filters above.
            </DialogDescription>
          </DialogHeader>

          {pending && (
            <div className="space-y-2" data-testid="preview-loading">
              <Skeleton className="h-6 w-2/3" /><Skeleton className="h-6 w-1/2" />
            </div>
          )}

          {result && (
            <div className="space-y-2 text-sm" data-testid="cleanup-result">
              <p className="font-medium">Cleanup finished</p>
              <p data-testid="result-deleted">Deleted {result.deletedCount} {result.deletedCount === 1 ? "image" : "images"}, reclaiming about {formatBytes(result.reclaimedBytes)}.</p>
              <p data-testid="result-skipped" className="text-muted-foreground">
                Skipped {result.skippedCount}. The server rechecks every image and skips any that gained a reference or changed since the preview.
              </p>
            </div>
          )}

          {(previewError || cleanupError || (expired && preview)) && !result && (
            <div role="alert" className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm" data-testid="cleanup-error">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
              <p>
                {expired && preview ? "This preview has expired." : previewError ?? cleanupError}{" "}
                {cleanupError
                  ? "The result could not be confirmed. Refresh the list and get a new preview before continuing."
                  : "Get a new preview to continue."}
              </p>
            </div>
          )}

          {preview && !result && (
            <div className="space-y-4">
              <div className="rounded-md border border-border p-3 text-sm space-y-1" data-testid="preview-summary">
                <p><span className="font-semibold" data-testid="preview-count">{preview.count}</span> unused {preview.count === 1 ? "image" : "images"} older than {preview.gracePeriodDays} days</p>
                <p className="text-muted-foreground">Estimated logical storage: <span data-testid="preview-bytes">{formatBytes(preview.reclaimableBytes)}</span></p>
                <p className="text-xs text-muted-foreground">Preview expires {format(new Date(preview.expiresAt), "p")}.</p>
              </div>
              {preview.count === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="preview-zero">There is nothing to clean up right now.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-destructive font-medium">
                    Deletion is permanent and cannot be undone. Back up first.
                  </p>
                  <Label htmlFor="cleanup-confirm" className="text-sm">
                    Type <span className="font-mono">{CONFIRM_PHRASE}</span> to confirm
                  </Label>
                  <Input id="cleanup-confirm" value={typed} onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off" data-testid="input-cleanup-confirm" />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {result ? (
              <Button onClick={closeDialog} data-testid="button-cleanup-close">Close</Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeDialog} disabled={cleanupMutation.isPending} data-testid="button-cleanup-cancel">
                  Cancel
                </Button>
                {needsNewPreview ? (
                  <Button onClick={startPreview} disabled={pending} data-testid="button-cleanup-new-preview">
                    Get new preview
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={runCleanup} disabled={!canDelete} data-testid="button-cleanup-delete">
                    {cleanupMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Permanently delete
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
