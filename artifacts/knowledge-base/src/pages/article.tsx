import DOMPurify from "dompurify";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  useGetArticle,
  useGetLogEntry,
  getGetLogEntryQueryKey,
  useGetArticleBacklinks,
  getGetArticleQueryKey,
  getGetArticleBacklinksQueryKey,
  useDeleteArticle,
  useListPolicySubjects,
  useRunProcedure,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertCircle, Play, ChevronRight, Loader2, Edit, Trash2, Download, Lock, ChevronLeft, FileText, FilePlus, Clock, PencilLine,
} from "lucide-react";
import { format } from "date-fns";
import { AREA_BASE, KIND_AREA, KIND_LABEL, articlePathFor, normalizeKind, type ContentArea } from "@/lib/content-paths";
import { subjectPath } from "@/lib/policy-subjects";
import { useSiteSettings } from "@/lib/site-settings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface LockStatus {
  articleId: number;
  lockedBy: { userId: number; userName: string; lockedAt: string } | null;
}

interface TableOfContentsItem {
  id: string;
  level: number;
  text: string;
}

function addHeadingAnchors(root: ParentNode): TableOfContentsItem[] {
  const usedIds = new Set<string>();
  const items: TableOfContentsItem[] = [];
  const headings = root.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6");

  headings.forEach((heading, index) => {
    const text = heading.textContent?.trim() ?? "";
    if (!text) return;

    const baseId =
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80) || `section-${index + 1}`;
    let id = baseId;
    let duplicateNumber = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${duplicateNumber}`;
      duplicateNumber += 1;
    }
    usedIds.add(id);
    heading.id = id;
    items.push({ id, level: Number(heading.tagName.slice(1)), text });
  });

  return items;
}

// Keep browser-rendered wikilinks aligned with the API's article slug policy.
function knowledgeSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export default function ArticleView({ params, area = "knowledge" }: { params?: { slug?: string; userId?: string; logSlug?: string; projectId?: string }; area?: ContentArea }) {
  const { slug, userId: userIdParam, logSlug, projectId: projectIdParam } = params || {};
  const projectId = Number(projectIdParam);
  const isProjectDocument = Number.isSafeInteger(projectId) && projectId > 0;
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isHome = !slug || slug === "home";
  const actualSlug = slug || "home";
  const logOwnerId = Number(userIdParam);
  const isLogRoute = Number.isSafeInteger(logOwnerId) && logOwnerId > 0 && Boolean(logSlug);

  const { data: article, isLoading, isError, error: articleError, refetch: refetchArticle } = useGetArticle(actualSlug, {
    query: {
      enabled: !!actualSlug && !isLogRoute,
      queryKey: [...getGetArticleQueryKey(actualSlug), user?.id],
      retry: false,
    },
  });
  const {
    data: logArticle,
    isLoading: isLoadingLog,
    isError: isLogError,
    error: logError,
    refetch: refetchLogArticle,
  } = useGetLogEntry(logOwnerId, logSlug ?? "", {
    query: { enabled: isLogRoute, retry: false, queryKey: [...getGetLogEntryQueryKey(logOwnerId, logSlug ?? ""), user?.id] },
  });
  const displayedArticle = isLogRoute ? logArticle : article;
  const displayedIsLoading = isLogRoute ? isLoadingLog : isLoading;
  const displayedIsError = isLogRoute ? isLogError : isError;
  const displayedError = isLogRoute ? logError : articleError;
  const displayedRefetch = isLogRoute ? refetchLogArticle : refetchArticle;
  const articleIsMissing = displayedIsError && errorStatus(displayedError) === 404;
  const apiSlug = displayedArticle?.slug ?? actualSlug;
  const articlePath = isLogRoute
    ? `/logs/${logOwnerId}/${logSlug}`
    : isProjectDocument
      ? `/projects/${projectId}/documents/${actualSlug}`
      : `${AREA_BASE[area]}/${actualSlug}`;
  const kind = normalizeKind(displayedArticle?.kind);
  const kindArea = KIND_AREA[kind];
  const { data: siteSettings } = useSiteSettings();
  const { data: subjects = [] } = useListPolicySubjects({ query: { enabled: kind === "policy", queryKey: ["/api/policy-subjects"] } });
  const categoryPath = kind === "policy" ? subjectPath(subjects, displayedArticle?.policySubjectId) : [];

  // Open documents under their canonical area (old links and cross-area links keep working).
  useEffect(() => {
    if (displayedArticle && !isLogRoute && !isProjectDocument && kindArea !== area) {
      setLocation(`${AREA_BASE[kindArea]}/${displayedArticle.slug}`, { replace: true });
    }
  }, [displayedArticle, isLogRoute, isProjectDocument, kindArea, area, setLocation]);

  // ─── Edit lock status ─────────────────────────────────────────────────────
  const [lockStatus, setLockStatus] = useState<LockStatus | null>(null);
  const [wikilinkStates, setWikilinkStates] = useState<Record<string, { status: "existing" | "missing"; kind: string }>>({});
  const [tableOfContents, setTableOfContents] = useState<TableOfContentsItem[]>([]);
  const articleContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!displayedArticle?.id || !user) return;

    const fetchLock = async () => {
      try {
        const res = await fetch(`/api/articles/${apiSlug}/lock`, { credentials: "include" });
        if (res.ok) {
          const data: LockStatus = await res.json();
          setLockStatus(data);
        }
      } catch {
        // ignore
      }
    };

    fetchLock();
    const interval = setInterval(fetchLock, 30_000);
    return () => clearInterval(interval);
  }, [displayedArticle?.id, apiSlug, user]);

  // Resolve wikilink targets after the article HTML has been rendered so the
  // visual treatment can distinguish real destinations from create-new links.
  useEffect(() => {
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("[data-wikilink-scope] a[data-wikilink='true']"),
    );
    const linkSlugs = new Set<string>();
    for (const link of links) {
      const linkSlug = link.dataset.slug;
      if (linkSlug) linkSlugs.add(linkSlug);
    }

    let cancelled = false;
    const resolveLinks = async () => {
      await Promise.all(Array.from(linkSlugs).map(async (linkSlug) => {
        try {
          const response = await fetch(`/api/articles/${encodeURIComponent(linkSlug)}`, {
            credentials: "include",
          });
          if (cancelled) return;
          const status = response.status === 404 ? "missing" : "existing";
          let linkKind = "knowledge";
          if (status === "existing" && response.ok) {
            const body = await response.json().catch(() => null) as { kind?: string } | null;
            linkKind = normalizeKind(body?.kind);
          }
          setWikilinkStates((current) =>
            current[linkSlug]?.status === status && current[linkSlug]?.kind === linkKind
              ? current
              : { ...current, [linkSlug]: { status, kind: linkKind } },
          );
        } catch {
          // Keep transient failures in the neutral pending style; a failed
          // probe should not make an otherwise valid link look missing.
        }
      }));
    };
    resolveLinks();
    return () => {
      cancelled = true;
    };
  }, [displayedArticle?.id, displayedArticle?.content, displayedArticle?.procedureSteps]);

  // Add in-page anchors to the rendered headings and derive the sidebar table
  // of contents from the same DOM the reader sees. Anchor IDs are added by
  // processContent so React rerenders cannot remove them.
  useEffect(() => {
    const content = articleContentRef.current;
    if (!content || !displayedArticle?.canAccess) {
      setTableOfContents([]);
      return;
    }

    const items: TableOfContentsItem[] = [];
    const headings = content.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6");

    headings.forEach((heading) => {
      const text = heading.textContent?.trim() ?? "";
      if (text && heading.id) {
        items.push({ id: heading.id, level: Number(heading.tagName.slice(1)), text });
      }
    });

    setTableOfContents(items);
  }, [displayedArticle?.id, displayedArticle?.content, displayedArticle?.canAccess, wikilinkStates]);

  const canEdit = Boolean((displayedArticle as (typeof displayedArticle & { canEdit?: boolean }) | undefined)?.canEdit);
  const lockHeldByOther = lockStatus?.lockedBy != null && lockStatus.lockedBy.userId !== user?.id;
  const lockHeldByMe = lockStatus?.lockedBy != null && lockStatus.lockedBy.userId === user?.id;

  const forceBreakLock = async () => {
    try {
      await fetch(`/api/articles/${apiSlug}/lock`, { method: "DELETE", credentials: "include" });
      setLockStatus((prev) => prev ? { ...prev, lockedBy: null } : prev);
      toast({ title: "Lock released" });
    } catch {
      toast({ title: "Failed to release lock", variant: "destructive" });
    }
  };

  const { data: backlinks } = useGetArticleBacklinks(apiSlug, {
    query: {
      enabled: !!apiSlug && !!displayedArticle?.canAccess,
      queryKey: getGetArticleBacklinksQueryKey(apiSlug),
    },
  });

  const deleteMutation = useDeleteArticle();

  const handleDelete = () => {
    deleteMutation.mutate(
      { slug: apiSlug },
      {
        onSuccess: () => {
          if (isLogRoute) {
            queryClient.removeQueries({ queryKey: ["log-entries-home"] });
            void queryClient.invalidateQueries({ queryKey: ["log-entries"] });
          }
          queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
          queryClient.invalidateQueries({ queryKey: ["home-search"] });
          toast({ title: isProjectDocument ? "Document deleted" : `${kind === "knowledge" ? "Article" : KIND_LABEL[kind]} deleted` });
          setLocation(isProjectDocument ? `/projects/${projectId}` : kind === "knowledge" ? "/" : AREA_BASE[kindArea]);
        },
        onError: (err) => {
          toast({
            title: "Error deleting article",
            description: err.message || "Unknown error",
            variant: "destructive",
          });
        },
      },
    );
  };

  const [runOpen, setRunOpen] = useState(false);
  const [runName, setRunName] = useState("");
  const runRequestIdRef = useRef("");
  const runMutation = useRunProcedure();
  const canRun = Boolean(user && (user.role === "admin" || user.role === "editor"));
  const projectsOn = siteSettings?.projectsEnabled !== false;

  const openRun = () => {
    runRequestIdRef.current = crypto.randomUUID();
    setRunName(displayedArticle?.title ?? "");
    setRunOpen(true);
  };
  const submitRun = () => {
    const name = runName.trim();
    if (!name || runMutation.isPending) return;
    runMutation.mutate(
      { slug: apiSlug, data: { name, requestId: runRequestIdRef.current } },
      {
        onSuccess: (result) => {
          setRunOpen(false);
          queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
          toast({ title: "Project created" });
          setLocation(`/projects/${result.projectId}/boards/${result.boardId}`);
        },
        onError: (err) => {
          toast({ title: "Could not run procedure", description: err.message, variant: "destructive" });
        },
      },
    );
  };

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const processContent = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;

    // Replace wikilinks only in visible text nodes. Replacing against the raw
    // HTML string can inject anchor markup into infobox data attributes such
    // as data-rows and corrupt the rest of the article markup.
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let currentNode: Node | null;
    while ((currentNode = walker.nextNode())) {
      textNodes.push(currentNode as Text);
    }

    for (const textNode of textNodes) {
      if (textNode.parentElement?.closest("a, script, style, textarea")) continue;

      const text = textNode.nodeValue ?? "";
      const wikilinkPattern = /\[\[([^\]]+)\]\]/g;
      if (!wikilinkPattern.test(text)) continue;
      wikilinkPattern.lastIndex = 0;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = wikilinkPattern.exec(text))) {
        const rawLink = match[1];
        const divider = rawLink.indexOf("|");
        const target = (divider === -1 ? rawLink : rawLink.slice(0, divider)).trim();
        const label = (divider === -1 ? rawLink : rawLink.slice(divider + 1)).trim();
        fragment.append(document.createTextNode(text.slice(lastIndex, match.index)));

        const linkSlug = knowledgeSlug(target);
        const link = document.createElement("a");
        const resolved = wikilinkStates[linkSlug];
        link.href = `${AREA_BASE[KIND_AREA[normalizeKind(resolved?.kind)]]}/${linkSlug}`;
        link.dataset.slug = linkSlug;
        const linkState = resolved?.status;
        link.className = `text-primary hover:text-primary/80 font-medium no-underline ${
          linkState ? `wikilink-${linkState}` : "wikilink-pending"
        }`;
        link.dataset.wikilink = "true";
        link.textContent = label || target;
        fragment.append(link);

        lastIndex = wikilinkPattern.lastIndex;
      }
      fragment.append(document.createTextNode(text.slice(lastIndex)));
      textNode.parentNode?.replaceChild(fragment, textNode);
    }

    // Captions are stored as an image data attribute so the editor can keep
    // images inline. Convert them to visible, safe text in the reader view.
    const captionedImages = Array.from(
      template.content.querySelectorAll<HTMLImageElement>("img[data-caption]"),
    );
    for (const image of captionedImages) {
      const caption = image.getAttribute("data-caption")?.trim();
      image.removeAttribute("data-caption");
      if (!caption || !image.parentNode) continue;

      const wrapper = document.createElement("span");
      wrapper.className = "article-image";
      const captionElement = document.createElement("span");
      captionElement.className = "image-caption";
      captionElement.textContent = caption;

      image.parentNode.insertBefore(wrapper, image);
      wrapper.append(image, captionElement);
    }

    addHeadingAnchors(template.content);
    return DOMPurify.sanitize(template.innerHTML, { USE_PROFILES: { html: true } });
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "A" && target.getAttribute("data-wikilink") === "true") {
        e.preventDefault();
        const href = target.getAttribute("href");
        if (href) setLocation(href);
        return;
      }
      if (target.tagName === "IMG" && target.closest("[data-testid='article-content']")) {
        const src = (target as HTMLImageElement).src;
        if (src) setLightboxSrc(src);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [setLocation]);

  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightboxSrc(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxSrc]);

  const triggerDownload = async (url: string, filename: string) => {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error("Export failed", err);
    }
  };

  const exportPdf = () => triggerDownload(`/api/articles/${apiSlug}/export/pdf`, `${displayedArticle?.title ?? apiSlug}.pdf`);
  const exportMd  = () => triggerDownload(`/api/articles/${apiSlug}/export/md`,  `${displayedArticle?.title ?? apiSlug}.md`);

  if (displayedIsLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (articleIsMissing) {
    if (isHome) {
      setLocation("/");
      return null;
    }

    const canEdit = user?.role === "admin" || user?.role === "editor";
    const displayTitle = actualSlug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    return (
      <div className="text-center py-20 space-y-4">
        <h2 className="text-2xl font-bold mb-2">Article not found</h2>
        <p className="text-muted-foreground">
          The article <strong>"{displayTitle}"</strong> doesn't exist yet.
        </p>
        <div className="flex items-center justify-center gap-3 mt-6">
          <Button variant="outline" onClick={() => setLocation("/")}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back to articles
          </Button>
          {canEdit && (
            <Button
              onClick={() =>
                setLocation(`/knowledge/new/edit?title=${encodeURIComponent(displayTitle)}`)
              }
              data-testid="button-create-from-wikilink"
            >
              <FilePlus className="mr-2 h-4 w-4" />
              Create this article
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (displayedIsError || !displayedArticle) {
    const resourceName = isLogRoute ? "log entry" : "article";
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10">
          <AlertCircle className="mx-auto mb-3 h-9 w-9 text-destructive" />
          <h2 className="text-2xl font-bold">Could not load this {resourceName}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {displayedError instanceof Error
              ? displayedError.message
              : "Please try again in a moment."}
          </p>
          <div className="mt-6 flex justify-center">
            <Button onClick={() => displayedRefetch()}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="flex flex-col lg:flex-row gap-8 pb-20">
      <div className="flex-1 max-w-3xl min-w-0">

        {/* Lock status banner */}
        {lockHeldByOther && lockStatus?.lockedBy && (
          <div className="mb-4 flex items-center gap-3 rounded-md border border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-700 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
            <PencilLine className="h-4 w-4 shrink-0 text-yellow-500" />
            <span>
              <strong>{lockStatus.lockedBy.userName}</strong> is currently editing this article.
            </span>
            {user?.role === "admin" && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900"
                onClick={forceBreakLock}
              >
                Force unlock
              </Button>
            )}
          </div>
        )}
        {lockHeldByMe && (
          <div className="mb-4 flex items-center gap-3 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-700 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
            <PencilLine className="h-4 w-4 shrink-0 text-blue-500" />
            <span>You are currently editing this article in another tab.</span>
          </div>
        )}

        <div className="mb-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-4xl font-extrabold tracking-tight" data-testid="article-title">
                {displayedArticle.title}
              </h1>
               {displayedArticle.visibility && (
                <Badge variant="outline" className="border-primary/20 text-primary bg-primary/5">
                   {displayedArticle.visibility === "personal" ? "Personal" : displayedArticle.visibility === "group" ? <><Lock className="w-3 h-3 mr-1" />Group</> : "Public"}
                </Badge>
              )}
               {kind !== "knowledge" && <Badge variant="secondary" data-testid="badge-kind">{KIND_LABEL[kind]}</Badge>}
               {displayedArticle.isStatic && <Badge variant="secondary" title="Does not require future review">Static</Badge>}
            </div>
            {kind === "policy" && categoryPath.length > 0 && (
              <nav aria-label="Policy category" className="mb-2 flex items-center flex-wrap gap-1 text-sm text-muted-foreground" data-testid="breadcrumb-policy">
                <Link href="/policies" className="hover:text-primary">Policies</Link>
                {categoryPath.map((p) => (
                  <span key={p.id} className="flex items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5" />
                    <Link href={`/policies?subject=${p.id}`} className="hover:text-primary">{p.name}</Link>
                  </span>
                ))}
              </nav>
            )}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Last updated: {format(new Date(displayedArticle.updatedAt), "MMMM d, yyyy 'at' h:mm a")}</span>
              {displayedArticle.updatedByName && <span>by {displayedArticle.updatedByName}</span>}
            </div>
          </div>
        </div>

        {!displayedArticle.canAccess ? (
          <Card className="border-dashed bg-muted/30">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Lock className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              {!user ? (
                <>
                  <h3 className="font-semibold text-lg mb-2">Login Required</h3>
                  <p className="text-muted-foreground max-w-sm mb-4">
                    Please log in to read this article.
                  </p>
                  <Button asChild variant="default">
                    <a href="/login">Log in</a>
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="font-semibold text-lg mb-2">Members Only</h3>
                  <p className="text-muted-foreground max-w-sm">
                    This article is restricted. You do not have the required group access to view its contents.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <div
            ref={articleContentRef}
            className="prose prose-stone dark:prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary prose-img:rounded-lg mt-8 prose-table:border-collapse prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-th:border prose-th:border-border prose-th:bg-muted [&_img]:cursor-zoom-in"
            dangerouslySetInnerHTML={{ __html: processContent(displayedArticle.content) }}
            data-testid="article-content"
            data-wikilink-scope="true"
          />
        )}

        {displayedArticle.canAccess && kind === "procedure" && (
          <section className="mt-10" data-testid="section-procedure-steps">
            <h2 className="text-xl font-semibold mb-4">Steps</h2>
            {(displayedArticle.procedureSteps ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">This procedure has no steps.</p>
            ) : (
              <ol className="space-y-4">
                {(displayedArticle.procedureSteps ?? []).map((step, i) => (
                  <li key={i} className="flex gap-4 border bg-card p-4" data-testid={`step-${i}`}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-primary text-primary-foreground text-sm font-semibold tabular-nums">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">{step.title}</h3>
                      <div
                        className="prose prose-stone dark:prose-invert max-w-none prose-sm mt-1 whitespace-pre-wrap"
                        data-wikilink-scope="true"
                        dangerouslySetInnerHTML={{ __html: processContent(step.description) }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>

      <div className="w-full lg:w-64 shrink-0 space-y-6">
        {canEdit && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <Button
                className="w-full justify-start"
                variant="outline"
                onClick={() => setLocation(`${articlePath}/edit`)}
                data-testid="button-edit-article"
              >
                <Edit className="mr-2 h-4 w-4" /> {isProjectDocument ? "Edit Document" : kind === "knowledge" ? "Edit Article" : `Edit ${KIND_LABEL[kind]}`}
              </Button>
              <Button
                className="w-full justify-start"
                variant="outline"
                onClick={() => setLocation(`${articlePath}/history`)}
              >
                <Clock className="mr-2 h-4 w-4" /> Version History
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    className="w-full justify-start"
                    variant="outline"
                    data-testid="button-delete-article"
                  >
                    <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                    <span className="text-destructive">Delete</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete the {isProjectDocument ? "document" : "article"}.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        )}

        {displayedArticle.canAccess && kind === "procedure" && canRun && (
          <Card>
            <CardContent className="p-4 space-y-2">
              <Button
                className="w-full justify-start"
                onClick={openRun}
                disabled={!projectsOn}
                data-testid="button-run-procedure"
              >
                <Play className="mr-2 h-4 w-4" /> Run procedure
              </Button>
              <p className="text-xs text-muted-foreground" data-testid="text-run-help">
                {projectsOn
                  ? "Creates a private project with one card per step."
                  : "Projects are turned off, so procedures cannot be run right now. Ask an administrator to enable Projects."}
              </p>
            </CardContent>
          </Card>
        )}

        {displayedArticle.canAccess && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Export</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="secondary" className="w-full justify-start" onClick={exportPdf}>
                <Download className="mr-2 h-4 w-4" /> Download PDF
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={exportMd}>
                <FileText className="mr-2 h-4 w-4" /> Download Markdown
              </Button>
            </CardContent>
          </Card>
        )}

        {displayedArticle.canAccess && tableOfContents.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Table of Contents</CardTitle>
            </CardHeader>
            <CardContent>
              <nav aria-label="Table of contents">
                <ul className="space-y-1.5 text-sm">
                  {tableOfContents.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className="block truncate text-muted-foreground hover:text-primary transition-colors"
                        style={{ paddingLeft: `${Math.max(0, item.level - 1) * 12}px` }}
                      >
                        {item.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </CardContent>
          </Card>
        )}

        {displayedArticle.canAccess && backlinks && backlinks.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Linked From</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {backlinks.map((link) => (
                  <li key={link.id}>
                    <Link
                      href={articlePathFor(link)}
                      className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-2"
                    >
                      <FileText className="h-3 w-3" />
                      <span className="truncate">{link.title}</span>
                      {normalizeKind(link.kind) !== "knowledge" && !link.logSlug && (
                        <span className="text-[10px] uppercase tracking-wide">{KIND_LABEL[normalizeKind(link.kind)]}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {displayedArticle.groups && displayedArticle.groups.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Required Groups</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {displayedArticle.groups.map((g) => (
                  <Badge key={g.id} variant="secondary">{g.name}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {displayedArticle.tags && displayedArticle.tags.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {displayedArticle.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full px-3 py-1 text-xs font-medium text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>

    <Dialog open={runOpen} onOpenChange={(o) => { if (!runMutation.isPending) setRunOpen(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Run procedure</DialogTitle>
          <DialogDescription>
            This creates a new private project you own, with one To Do card for each step. Later edits to the procedure will not change it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="run-name">Project name</Label>
          <Input
            id="run-name"
            value={runName}
            maxLength={200}
            onChange={(e) => setRunName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitRun(); }}
            data-testid="input-run-name"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRunOpen(false)} disabled={runMutation.isPending}>Cancel</Button>
          <Button onClick={submitRun} disabled={runMutation.isPending || !runName.trim()} data-testid="button-confirm-run">
            {runMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create project
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {lightboxSrc && (

      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 cursor-zoom-out"
        onClick={() => setLightboxSrc(null)}
      >
        <button
          className="absolute top-4 right-4 text-white/70 hover:text-white bg-black/40 rounded-full p-2 transition-colors"
          onClick={() => setLightboxSrc(null)}
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <img
          src={lightboxSrc}
          alt="Full size"
          className="max-h-[90vh] max-w-[90vw] object-contain rounded shadow-2xl cursor-default"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )}
    </>
  );
}
