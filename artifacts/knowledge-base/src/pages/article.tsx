import DOMPurify from "dompurify";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetArticle,
  useGetLogEntry,
  getGetLogEntryQueryKey,
  useGetArticleBacklinks,
  getGetArticleQueryKey,
  getGetArticleBacklinksQueryKey,
  useDeleteArticle,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertCircle, Loader2, Edit, Trash2, Download, Lock, ChevronLeft, FileText, FilePlus, Clock, PencilLine,
} from "lucide-react";
import { format } from "date-fns";
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

export default function ArticleView({ params }: { params?: { slug?: string; userId?: string; logSlug?: string } }) {
  const { slug, userId: userIdParam, logSlug } = params || {};
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const isHome = !slug || slug === "home";
  const actualSlug = slug || "home";
  const logOwnerId = Number(userIdParam);
  const isLogRoute = Number.isSafeInteger(logOwnerId) && logOwnerId > 0 && Boolean(logSlug);

  const { data: article, isLoading, isError, error: articleError, refetch: refetchArticle } = useGetArticle(actualSlug, {
    query: {
      enabled: !!actualSlug && !isLogRoute,
      queryKey: getGetArticleQueryKey(actualSlug),
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
    query: { enabled: isLogRoute, retry: false, queryKey: getGetLogEntryQueryKey(logOwnerId, logSlug ?? "") },
  });
  const displayedArticle = isLogRoute ? logArticle : article;
  const displayedIsLoading = isLogRoute ? isLoadingLog : isLoading;
  const displayedIsError = isLogRoute ? isLogError : isError;
  const displayedError = isLogRoute ? logError : articleError;
  const displayedRefetch = isLogRoute ? refetchLogArticle : refetchArticle;
  const articleIsMissing = displayedIsError && errorStatus(displayedError) === 404;
  const apiSlug = displayedArticle?.slug ?? actualSlug;
  const articlePath = isLogRoute ? `/logs/${logOwnerId}/${logSlug}` : `/knowledge/${actualSlug}`;

  // ─── Edit lock status ─────────────────────────────────────────────────────
  const [lockStatus, setLockStatus] = useState<LockStatus | null>(null);

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

  const canEdit = user?.role === "admin" || user?.role === "editor";
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
          toast({ title: "Article deleted" });
          setLocation("/");
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
        link.href = `/knowledge/${linkSlug}`;
        link.className = "text-primary hover:underline font-medium";
        link.dataset.wikilink = "true";
        link.textContent = label || target;
        fragment.append(link);

        lastIndex = wikilinkPattern.lastIndex;
      }
      fragment.append(document.createTextNode(text.slice(lastIndex)));
      textNode.parentNode?.replaceChild(fragment, textNode);
    }

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
              {displayedArticle.isRestricted && (
                <Badge variant="outline" className="border-primary/20 text-primary bg-primary/5">
                  <Lock className="w-3 h-3 mr-1" />
                  Restricted
                </Badge>
              )}
            </div>
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
            className="prose prose-stone dark:prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary prose-img:rounded-lg mt-8 prose-table:border-collapse prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-2 prose-th:bg-muted [&_img]:cursor-zoom-in"
            dangerouslySetInnerHTML={{ __html: processContent(displayedArticle.content) }}
            data-testid="article-content"
          />
        )}
      </div>

      <div className="w-full lg:w-64 shrink-0 space-y-6">
        {canEdit && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <Button
                className="w-full justify-start"
                variant="outline"
                onClick={() => setLocation(isLogRoute ? `${articlePath}/edit` : `/knowledge/${actualSlug}/edit`)}
                data-testid="button-edit-article"
              >
                <Edit className="mr-2 h-4 w-4" /> Edit Article
              </Button>
              <Button
                className="w-full justify-start"
                variant="outline"
                onClick={() => setLocation(isLogRoute ? `${articlePath}/history` : `/knowledge/${actualSlug}/history`)}
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
                      This action cannot be undone. This will permanently delete the article.
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
                      href={link.logOwnerId && link.logSlug ? `/logs/${link.logOwnerId}/${link.logSlug}` : `/knowledge/${link.slug}`}
                      className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-2"
                    >
                      <FileText className="h-3 w-3" />
                      <span className="truncate">{link.title}</span>
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
