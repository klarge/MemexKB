import { useState, useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { useLocation } from "wouter";
import {
  useGetArticle,
  useGetLogEntry,
  getGetLogEntryQueryKey,
  getGetArticleQueryKey,
  useCreateArticle,
  useUpdateArticle,
  useUpdateArticleSlug,
  useListGroups,
  useListArticles,
  useListTags,
  getListTagsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, ArrowLeft, Save, Image as ImageIcon, Link as LinkIcon,
  Bold, Italic, List, ListOrdered, Heading1, Heading2, Code, Quote,
  Table as TableIcon, LayoutTemplate, PanelRight, AlertTriangle,
  Check, CloudOff, RotateCcw, X,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";

import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import { WikilinkExtension, type WikilinkItem } from "@/lib/wikilink-extension";
import { WikilinkList, type WikilinkListHandle } from "@/lib/wikilink-list";
import { ResizableImageView } from "@/lib/resizable-image";
import { InfoBoxExtension } from "@/lib/infobox-extension";

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.width) return {};
          return { width: String(attributes.width) };
        },
        parseHTML: (element: HTMLElement) => {
          const attr = element.getAttribute("width");
          if (attr) return parseInt(attr, 10) || null;
          const sw = element.style.width;
          return sw ? parseInt(sw, 10) || null : null;
        },
      },
      caption: {
        default: "",
        renderHTML: (attributes: Record<string, unknown>) => {
          const caption = typeof attributes.caption === "string" ? attributes.caption.trim() : "";
          return caption ? { "data-caption": caption } : {};
        },
        parseHTML: (element: HTMLElement) => element.getAttribute("data-caption") || "",
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

// ─── Autosave status indicator ────────────────────────────────────────────────

type AutosaveStatus = "idle" | "saving" | "saved" | "error";

function AutosaveChip({ status }: { status: AutosaveStatus }) {
  if (status === "idle") return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground select-none">
      {status === "saving" && (
        <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>
      )}
      {status === "saved" && (
        <><Check className="h-3 w-3 text-green-500" /> Saved</>
      )}
      {status === "error" && (
        <><CloudOff className="h-3 w-3 text-destructive" /><span className="text-destructive">Autosave failed</span></>
      )}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ArticleEdit({ params }: { params?: { slug?: string; userId?: string; logSlug?: string; projectId?: string } }) {
  const { slug, userId: userIdParam, logSlug, projectId: projectIdParam } = params || {};
  const projectId = Number(projectIdParam);
  const isProjectDocument = Number.isSafeInteger(projectId) && projectId > 0;
  const logOwnerId = Number(userIdParam);
  const isLogRoute = Number.isSafeInteger(logOwnerId) && logOwnerId > 0 && Boolean(logSlug);
  const isNew = !isLogRoute && (!slug || slug === "new");
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const isLog = isLogRoute || (isNew && searchParams.get("log") === "1");
  const prefillTitle = isNew
    ? (isLog
        ? new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : searchParams.get("title") || "")
    : "";

  const draftKey = isLog ? "memex-draft-log" : isProjectDocument ? `memex-draft-project-${projectId}` : "memex-draft-article";

  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [title, setTitle] = useState(prefillTitle);
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [isLogSaving, setIsLogSaving] = useState(false);
  const [isProjectSaving, setIsProjectSaving] = useState(false);
  const [slugDialogOpen, setSlugDialogOpen] = useState(false);
  const [slugDraft, setSlugDraft] = useState("");

  // ── Autosave state ──────────────────────────────────────────────────────────
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const [draftBanner, setDraftBanner] = useState(false);

  // Refs so autosave timer always captures the latest values
  const titleRef = useRef(title);
  const groupsRef = useRef(selectedGroups);
  const tagsRef = useRef(selectedTags);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks what was last successfully saved to the server (existing articles)
  const lastSavedRef = useRef<{ title: string; content: string } | null>(null);
  // Prevents background query refreshes after autosave from replacing the
  // document the user is actively editing.
  const loadedArticleKeyRef = useRef<string | null>(null);
  // Draft content to apply once the editor is ready (new articles)
  const pendingDraftRef = useRef<string | null>(null);
  // Stable ref to the schedule function so editor.on('update') never goes stale
  const scheduleAutosaveRef = useRef<() => void>(() => {});

  // Keep refs current every render
  titleRef.current = title;
  groupsRef.current = selectedGroups;
  tagsRef.current = selectedTags;

  const { data: templates = [] } = useQuery<{ id: number; name: string; content: string; tags: { id: number; name: string; color: string }[] }[]>({
    queryKey: ["templates"],
    queryFn: () => fetch("/api/templates").then((r) => r.json()),
  });

  const { data: groupsData } = useListGroups();
  const { data: tagsData } = useListTags({ query: { queryKey: getListTagsQueryKey() } });
  // Limit to 100 most-recently-updated articles for wikilink autocomplete.
  // 500 was unnecessarily large and would be slow at scale.
  const { data: articlesData } = useListArticles({ limit: 100, sort: "updated_at", order: "desc" });

  const { data: regularArticle, isLoading: isLoadingArticle } = useGetArticle(slug as string, {
    query: {
      enabled: !isNew && !isLogRoute && !!slug,
      queryKey: getGetArticleQueryKey(slug as string),
      retry: false,
    },
  });
  const { data: logArticle, isLoading: isLoadingLog } = useGetLogEntry(logOwnerId, logSlug ?? "", {
    query: { enabled: isLogRoute, retry: false, queryKey: getGetLogEntryQueryKey(logOwnerId, logSlug ?? "") },
  });
  const article = isLogRoute ? logArticle : regularArticle;
  const articleSlug = article?.slug ?? slug;
  const articlePath = isLogRoute
    ? `/logs/${logOwnerId}/${logSlug}`
    : isProjectDocument
      ? `/projects/${projectId}/documents/${articleSlug}`
      : `/knowledge/${articleSlug}`;
  const editorArticleKey = isLogRoute
    ? `log:${logOwnerId}:${logSlug}`
    : `${isProjectDocument ? `project:${projectId}:` : "article:"}${articleSlug ?? ""}`;

  const createMutation = useCreateArticle();
  const updateMutation = useUpdateArticle();
  const updateSlugMutation = useUpdateArticleSlug();

  const openSlugDialog = () => {
    setSlugDraft(article?.slug ?? slug ?? "");
    setSlugDialogOpen(true);
  };

  const saveSlug = () => {
    if (!slug) return;
    const nextSlug = slugDraft.trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nextSlug) || nextSlug.length > 100) {
      toast({
        title: "Invalid URL",
        description: "Use lowercase letters, numbers, and single hyphens only.",
        variant: "destructive",
      });
      return;
    }
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    updateSlugMutation.mutate(
      { slug, data: { slug: nextSlug } },
      {
        onSuccess: async (data) => {
          await releaseLock();
          queryClient.invalidateQueries({ queryKey: getGetArticleQueryKey(slug) });
          queryClient.invalidateQueries({ queryKey: getGetArticleQueryKey(data.slug) });
          toast({
            title: "Article URL updated",
            description: data.rewrittenArticles
              ? `Updated links in ${data.rewrittenArticles} article${data.rewrittenArticles === 1 ? "" : "s"}.`
              : "No internal links needed updating.",
          });
          setSlugDialogOpen(false);
          setLocation(`/knowledge/${data.slug}`);
        },
        onError: (err) => {
          toast({
            title: "Could not update URL",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  // ─── Edit lock ────────────────────────────────────────────────────────────────
  const [lockConflict, setLockConflict] = useState<{ userName: string } | null>(null);
  const lockReleasedRef = useRef(false);

  const releaseLock = useCallback(async () => {
    if (isNew || !articleSlug || lockReleasedRef.current) return;
    lockReleasedRef.current = true;
    try {
      await fetch(`/api/articles/${articleSlug}/lock`, { method: "DELETE", credentials: "include" });
    } catch {
      // best-effort
    }
  }, [isNew, articleSlug]);

  useEffect(() => {
    if (isNew || !articleSlug) return;

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const acquireLock = async () => {
      try {
        const res = await fetch(`/api/articles/${articleSlug}/lock`, {
          method: "PUT",
          credentials: "include",
        });
        if (res.status === 409) {
          const data = await res.json();
          setLockConflict({ userName: data.lockedBy?.userName ?? "Another user" });
        }
      } catch {
        // ignore network errors; don't block editing
      }
    };

    acquireLock();
    heartbeatTimer = setInterval(acquireLock, 60_000);

    return () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      releaseLock();
    };
  }, [isNew, articleSlug, releaseLock]);

  useEffect(() => {
    if (isNew || !articleSlug) return;
    const onUnload = () => {
      if (!lockReleasedRef.current) {
        fetch(`/api/articles/${articleSlug}/lock`, { method: "DELETE", credentials: "include", keepalive: true }).catch(() => {});
        lockReleasedRef.current = true;
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [isNew, articleSlug]);

  // ─── Wikilink items ref ───────────────────────────────────────────────────────
  const wikilinkItemsRef = useRef<WikilinkItem[]>([]);
  useEffect(() => {
    wikilinkItemsRef.current = (articlesData?.articles ?? []).map((a) => ({
      slug: a.slug,
      title: a.title,
    }));
  }, [articlesData]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Placeholder.configure({ placeholder: "Write your article content here…" }),
      ResizableImage.configure({ inline: true, allowBase64: true }),
      Link.configure({ openOnClick: false }),

      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,

      InfoBoxExtension,

      WikilinkExtension.configure({
        suggestion: {
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase();
            return wikilinkItemsRef.current
              .filter((a) => a.title.toLowerCase().includes(q))
              .slice(0, 10);
          },
          render: () => {
            let container: HTMLElement;
            let root: ReturnType<typeof createRoot>;
            let componentRef: WikilinkListHandle | null = null;

            return {
              onStart(props: SuggestionProps<WikilinkItem>) {
                container = document.createElement("div");
                container.style.cssText =
                  "position: absolute; z-index: 9999; pointer-events: auto;";
                document.body.appendChild(container);
                const rect = props.clientRect?.();
                if (rect) {
                  container.style.top = `${rect.bottom + window.scrollY + 4}px`;
                  container.style.left = `${rect.left + window.scrollX}px`;
                }
                root = createRoot(container);
                root.render(
                  <WikilinkList
                    ref={(ref) => { componentRef = ref; }}
                    items={props.items}
                    command={props.command}
                  />,
                );
              },
              onUpdate(props: SuggestionProps<WikilinkItem>) {
                const rect = props.clientRect?.();
                if (rect && container) {
                  container.style.top = `${rect.bottom + window.scrollY + 4}px`;
                  container.style.left = `${rect.left + window.scrollX}px`;
                }
                root?.render(
                  <WikilinkList
                    ref={(ref) => { componentRef = ref; }}
                    items={props.items}
                    command={props.command}
                  />,
                );
              },
              onKeyDown({ event }: SuggestionKeyDownProps) {
                return componentRef?.onKeyDown(event) ?? false;
              },
              onExit() {
                root?.unmount();
                container?.remove();
              },
            };
          },
        },
      }),
    ],
    content: article?.content || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-stone dark:prose-invert max-w-none focus:outline-none min-h-[500px] p-4 border rounded-md bg-card",
      },
      handlePaste: (view, event) => {
        const items = Array.from(event.clipboardData?.items || []);
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
              const fd = new FormData();
              fd.append("file", file);
              fetch("/api/articles/images", { method: "POST", body: fd })
                .then((r) => r.json())
                .then((data: { url: string }) => {
                  const { schema } = view.state;
                  const node = schema.nodes.image.create({ src: data.url });
                  const tr = view.state.tr.replaceSelectionWith(node);
                  view.dispatch(tr);
                })
                .catch(() => {});
            }
            return true;
          }
        }
        return false;
      },
    },
  });

  // ─── Load article into form ────────────────────────────────────────────────
  useEffect(() => {
    if (!article || isNew || !editor || loadedArticleKeyRef.current === editorArticleKey) return;

    loadedArticleKeyRef.current = editorArticleKey;
    setTitle(article.title);
    setSelectedGroups(article.groups?.map((g) => g.id) || []);
    setSelectedTags(article.tags?.map((t) => t.id) || []);
    if (editor.getHTML() !== article.content) {
      // Pass false as emitUpdate so this programmatic load does NOT fire
      // the editor's "update" event and accidentally schedule an autosave.
      editor.commands.setContent(article.content, { emitUpdate: false });
    }
    // Seed lastSavedRef with the *normalized* HTML that Tiptap produces,
    // not the raw string from the server — they can differ in whitespace /
    // attribute ordering, which would cause the diff check to think content
    // changed and trigger a spurious save on first open.
    lastSavedRef.current = { title: article.title, content: editor.getHTML() };
  }, [article, isNew, editor, editorArticleKey]);

  // ─── Draft restore (new articles) ─────────────────────────────────────────
  useEffect(() => {
    if (!isNew) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as { title?: string; content?: string };
      const hasContent = draft.title?.trim() || (draft.content && draft.content !== "<p></p>");
      if (!hasContent) return;
      if (draft.title) setTitle(draft.title);
      if (draft.content) pendingDraftRef.current = draft.content;
      setDraftBanner(true);
    } catch {
      localStorage.removeItem(draftKey);
    }
  }, [isNew, draftKey]);

  // Apply pending draft content once the editor is ready
  useEffect(() => {
    if (!editor || !pendingDraftRef.current) return;
    editor.commands.setContent(pendingDraftRef.current);
    pendingDraftRef.current = null;
  }, [editor]);

  // ─── Autosave: existing articles ──────────────────────────────────────────
  const scheduleAutosave = useCallback(() => {
    if (isNew || !articleSlug || !editor) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(async () => {
      if (!lastSavedRef.current) return;

      const currentTitle = titleRef.current.trim();
      const currentContent = editor.getHTML();

      if (!currentTitle) return;
      if (
        currentTitle === lastSavedRef.current.title &&
        currentContent === lastSavedRef.current.content
      ) return;

      setAutosaveStatus("saving");
      try {
        const res = await fetch(`/api/articles/${articleSlug}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            title: currentTitle,
            content: currentContent,
            groupIds: isLog || isProjectDocument ? undefined : groupsRef.current,
            tagIds: tagsRef.current,
          }),
        });
        if (!res.ok) throw new Error("autosave failed");
        const savedArticle = await res.json();
        lastSavedRef.current = { title: currentTitle, content: currentContent };
        setAutosaveStatus("saved");
        // Keep other views in sync without refetching the article being edited.
        // A refetch here can arrive while the user has typed more characters,
        // causing the load effect to replace their newer local document.
        queryClient.setQueryData(getGetArticleQueryKey(articleSlug), savedArticle);
      } catch {
        setAutosaveStatus("error");
      }
    }, 3000);
  }, [isNew, articleSlug, editor, queryClient]);

  // ─── Autosave: new articles → localStorage ────────────────────────────────
  const scheduleDraftSave = useCallback(() => {
    if (!isNew || !editor) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(() => {
      const currentTitle = titleRef.current;
      const currentContent = editor.getHTML();
      const isEmpty = !currentTitle.trim() && currentContent === "<p></p>";
      if (isEmpty) return;
      try {
        localStorage.setItem(draftKey, JSON.stringify({ title: currentTitle, content: currentContent }));
        setAutosaveStatus("saved");
      } catch {
        // storage quota — silently ignore
      }
    }, 3000);
  }, [isNew, editor, draftKey]);

  // Keep the ref current (avoids stale closures in editor.on)
  scheduleAutosaveRef.current = isNew ? scheduleDraftSave : scheduleAutosave;

  // Wire up editor → autosave
  useEffect(() => {
    if (!editor) return;
    const handler = () => scheduleAutosaveRef.current();
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor]);

  // Wire up title change → autosave (for existing articles)
  useEffect(() => {
    if (!lastSavedRef.current) return; // article not loaded yet
    scheduleAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  // Wire up title change → draft save (for new articles)
  useEffect(() => {
    if (!isNew) return;
    scheduleDraftSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, isNew]);

  // Fade "saved" chip back to idle after 3 s
  useEffect(() => {
    if (autosaveStatus !== "saved") return;
    const t = setTimeout(() => setAutosaveStatus("idle"), 3000);
    return () => clearTimeout(t);
  }, [autosaveStatus]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  // ─── Manual save ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    // Cancel any pending autosave
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    const content = editor?.getHTML() || "";

    if (isNew && isLog) {
      setIsLogSaving(true);
      try {
        const res = await fetch("/api/articles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title, content, groupIds: selectedGroups, tagIds: selectedTags, isLogEntry: true }),
        });
        if (!res.ok) {
          const err = await res.json();
          toast({ title: "Failed to create", description: err.error, variant: "destructive" });
          return;
        }
        const data = await res.json() as { slug: string; logSlug?: string | null; logOwnerId?: number | null };
        localStorage.removeItem(draftKey);
        toast({ title: "Log entry created" });
        if (!data.logSlug || !data.logOwnerId) throw new Error("The server did not return the new log URL");
        setLocation(`/logs/${data.logOwnerId}/${data.logSlug}`);
      } catch {
        toast({ title: "Network error", variant: "destructive" });
      } finally {
        setIsLogSaving(false);
      }
      return;
    }

    if (isNew && isProjectDocument) {
      setIsProjectSaving(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title, content, tagIds: selectedTags }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed to create document" }));
          toast({ title: "Failed to create document", description: err.error, variant: "destructive" });
          return;
        }
        const data = await res.json() as { slug: string };
        localStorage.removeItem(draftKey);
        toast({ title: "Document created" });
        setLocation(`/projects/${projectId}/documents/${data.slug}`);
      } catch {
        toast({ title: "Network error", variant: "destructive" });
      } finally {
        setIsProjectSaving(false);
      }
      return;
    }

    if (isNew) {
      createMutation.mutate(
        { data: { title, content, groupIds: isLog ? undefined : selectedGroups, tagIds: selectedTags } },
        {
          onSuccess: (data) => {
            localStorage.removeItem(draftKey);
            toast({ title: "Article created" });
            setLocation(`/knowledge/${data.slug}`);
          },
          onError: (err) => {
            toast({ title: "Failed to create", description: err.message, variant: "destructive" });
          },
        },
      );
    } else if (articleSlug) {
      updateMutation.mutate(
        { slug: articleSlug, data: { title, content, groupIds: isLog || isProjectDocument ? undefined : selectedGroups, tagIds: selectedTags } },
        {
          onSuccess: async (data) => {
            lastSavedRef.current = { title, content };
            setAutosaveStatus("idle");
            queryClient.invalidateQueries({ queryKey: getGetArticleQueryKey(articleSlug) });
            toast({ title: "Article updated" });
            await releaseLock();
            setLocation(isLogRoute || isProjectDocument ? articlePath : `/knowledge/${data.slug}`);
          },
          onError: (err) => {
            toast({ title: "Failed to update", description: err.message, variant: "destructive" });
          },
        },
      );
    }
  };

  const toggleGroup = (id: number) => {
    setSelectedGroups((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  if (!isNew && (isLoadingArticle || isLoadingLog)) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  }

  const isPending = isLogSaving || isProjectSaving || createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation(
            isLog
              ? (isLogRoute ? articlePath : "/log")
              : isNew
                ? (isProjectDocument ? `/projects/${projectId}` : "/")
                : articlePath,
          )}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">
          {isLog ? "Create Log Entry" : isNew ? (isProjectDocument ? "Create Document" : "Create Article") : isProjectDocument ? "Edit Document" : "Edit Article"}
        </h1>
        <div className="flex-1" />
        <AutosaveChip status={autosaveStatus} />
        <Button onClick={handleSave} disabled={isPending} data-testid="button-save-article">
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>
      </div>

      {/* Draft restored banner */}
      {draftBanner && (
        <div className="flex items-center gap-3 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-700 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
          <RotateCcw className="h-4 w-4 shrink-0 text-blue-500" />
          <span>Your unsaved draft has been restored. Save to keep it permanently.</span>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(draftKey);
              setDraftBanner(false);
            }}
            className="ml-auto text-blue-500 hover:text-blue-700 dark:hover:text-blue-200"
            aria-label="Dismiss and discard draft"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {lockConflict && (
        <div className="flex items-center gap-3 rounded-md border border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-700 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" />
          <span>
            <strong>{lockConflict.userName}</strong> is currently editing this article. Your changes may conflict.
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900"
            onClick={() => setLocation(articlePath)}
          >
            View read-only
          </Button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="title" className="text-base">Article Title</Label>
              {!isNew && !isLog && !isProjectDocument && user?.role === "admin" && (
                <Button type="button" variant="outline" size="sm" onClick={openSlugDialog}>
                  Edit URL
                </Button>
              )}
            </div>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Q3 Engineering Guidelines"
              className="text-lg font-medium py-6"
              data-testid="input-article-title"
            />
            {!isNew && (
              <p className="text-xs text-muted-foreground">
                URL: <span className="font-mono">{articlePath}</span>
              </p>
            )}
          </div>

          <Dialog open={slugDialogOpen} onOpenChange={setSlugDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Edit article URL</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <DialogDescription>
                  This updates all internal bracket links that point to this article. The old URL will stop working.
                </DialogDescription>
                <div className="space-y-2">
                  <Label htmlFor="article-slug">URL ending</Label>
                  <div className="flex items-center rounded-md border border-input bg-muted/40 px-3">
                    <span className="text-sm text-muted-foreground">/knowledge/</span>
                    <Input
                      id="article-slug"
                      value={slugDraft}
                      onChange={(event) => setSlugDraft(event.target.value)}
                      className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only.</p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setSlugDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={saveSlug} disabled={updateSlugMutation.isPending}>
                    {updateSlugMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Update URL
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <div className="space-y-2">
            <Label className="text-base">Content</Label>

            {editor && (
              <div className="border border-border rounded-md bg-card overflow-hidden sticky top-0 z-10 shadow-sm mb-2 flex items-center p-1 gap-0.5 flex-wrap">
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive("bold") ? "bg-muted" : ""}><Bold className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive("italic") ? "bg-muted" : ""}><Italic className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={editor.isActive("heading", { level: 1 }) ? "bg-muted" : ""}><Heading1 className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive("heading", { level: 2 }) ? "bg-muted" : ""}><Heading2 className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive("bulletList") ? "bg-muted" : ""}><List className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive("orderedList") ? "bg-muted" : ""}><ListOrdered className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={editor.isActive("blockquote") ? "bg-muted" : ""}><Quote className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={editor.isActive("codeBlock") ? "bg-muted" : ""}><Code className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button variant="ghost" size="sm" onClick={() => {
                  const url = window.prompt("URL");
                  if (url) editor.chain().focus().setLink({ href: url }).run();
                }} className={editor.isActive("link") ? "bg-muted" : ""}><LinkIcon className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  const url = window.prompt("Image URL");
                  if (url) editor.chain().focus().setImage({ src: url }).run();
                }}><ImageIcon className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button
                  variant="ghost"
                  size="sm"
                  title="Insert table"
                  onClick={() =>
                    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
                  }
                >
                  <TableIcon className="h-4 w-4" />
                </Button>
                {editor.isActive("table") && (
                  <>
                    <Button variant="ghost" size="sm" title="Add column before" onClick={() => editor.chain().focus().addColumnBefore().run()} className="text-xs px-2">+col▶</Button>
                    <Button variant="ghost" size="sm" title="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()} className="text-xs px-2">+row▼</Button>
                    <Button variant="ghost" size="sm" title="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()} className="text-xs px-2 text-destructive">−col</Button>
                    <Button variant="ghost" size="sm" title="Delete row" onClick={() => editor.chain().focus().deleteRow().run()} className="text-xs px-2 text-destructive">−row</Button>
                  </>
                )}
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button
                  variant="ghost"
                  size="sm"
                  title="Insert infobox"
                  onClick={() =>
                    editor.chain().focus().insertContent({
                      type: "infobox",
                      attrs: {
                        title: "",
                        rows: JSON.stringify([
                          { label: "", value: "" },
                          { label: "", value: "" },
                          { label: "", value: "" },
                        ]),
                      },
                    }).run()
                  }
                >
                  <PanelRight className="h-4 w-4" />
                </Button>
                {templates.length > 0 && (
                  <>
                    <div className="w-px h-6 bg-border mx-0.5" />
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Insert template"
                      onClick={() => setTemplateDialogOpen(true)}
                    >
                      <LayoutTemplate className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            )}

            <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <LayoutTemplate className="h-5 w-5" /> Insert Template
                  </DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground -mt-1">
                  Choose a template to insert at the current cursor position.
                </p>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      className="w-full text-left rounded-md border border-border px-4 py-3 hover:bg-muted transition-colors"
                      onClick={() => {
                        editor?.chain().focus().insertContent(t.content).run();
                        if (t.tags?.length) {
                          setSelectedTags((prev) => {
                            const next = [...prev];
                            for (const tag of t.tags) {
                              if (!next.includes(tag.id)) next.push(tag.id);
                            }
                            return next;
                          });
                        }
                        setTemplateDialogOpen(false);
                      }}
                    >
                      <p className="font-medium text-sm">{t.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {t.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
                      </p>
                    </button>
                  ))}
                </div>
              </DialogContent>
            </Dialog>

            <EditorContent editor={editor} />
          </div>
        </div>

        <div className="w-full lg:w-72 shrink-0 space-y-6">
          <Card>
            <CardContent className="p-4 space-y-4">
              {tagsData && tagsData.length > 0 && (
                <div>
                  <Label className="mb-2 block">Tags</Label>
                  <div className="flex flex-wrap gap-2">
                    {tagsData.map((tag) => {
                      const selected = selectedTags.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() =>
                            setSelectedTags((prev) =>
                              selected ? prev.filter((id) => id !== tag.id) : [...prev, tag.id],
                            )
                          }
                          className="rounded-full px-3 py-1 text-xs font-medium border transition-all"
                          style={
                            selected
                              ? { backgroundColor: tag.color, color: "#fff", borderColor: tag.color }
                              : { backgroundColor: "transparent", color: tag.color, borderColor: tag.color }
                          }
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {!isProjectDocument && (
              <div>
                <Label className="mb-2 block">Access Control</Label>
                <p className="text-xs text-muted-foreground mb-3">
                  Restrict this article to specific groups. If no groups are selected, everyone can access it.
                </p>
                <div className="space-y-2">
                  {groupsData?.map((group) => (
                    <div key={group.id} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`group-${group.id}`}
                        checked={selectedGroups.includes(group.id)}
                        onChange={() => toggleGroup(group.id)}
                        className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                      />
                      <label
                        htmlFor={`group-${group.id}`}
                        className="text-sm font-medium leading-none cursor-pointer"
                      >
                        {group.name}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
              )}
              {isProjectDocument && (
                <div>
                  <Label className="mb-2 block">Project access</Label>
                  <p className="text-xs text-muted-foreground">
                    This document is shared with everyone who can access this project.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <Label className="mb-2 block">Editor Tips</Label>
              <ul className="text-xs text-muted-foreground space-y-2 list-disc pl-4">
                <li>Type <kbd className="bg-muted px-1 rounded border">[[</kbd> to link to another article with autocomplete.</li>
                <li>You can paste images directly into the editor.</li>
                <li>Drag the corner handle of any image to resize it.</li>
                <li>Use the <kbd className="bg-muted px-1 rounded border"><TableIcon className="h-3 w-3 inline" /></kbd> button to insert a table.</li>
                <li>Changes are saved automatically as you type.</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
