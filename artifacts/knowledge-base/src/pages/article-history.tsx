import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, ChevronLeft, Clock, RotateCcw, GitCompare, Eye, X,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
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
import { diffWords } from "diff";

type VersionSummary = {
  id: number;
  versionNumber: number;
  title: string;
  createdAt: string;
  createdByName: string | null;
};

type VersionFull = VersionSummary & { content: string };

function fetchVersions(slug: string): Promise<VersionSummary[]> {
  return fetch(`/api/articles/${slug}/versions`).then((r) => {
    if (!r.ok) throw new Error("Failed to load history");
    return r.json();
  });
}

function fetchVersion(slug: string, versionId: number): Promise<VersionFull> {
  return fetch(`/api/articles/${slug}/versions/${versionId}`).then((r) => {
    if (!r.ok) throw new Error("Failed to load version");
    return r.json();
  });
}

function restoreVersion(slug: string, versionId: number): Promise<void> {
  return fetch(`/api/articles/${slug}/versions/${versionId}/restore`, { method: "POST" }).then(
    (r) => { if (!r.ok) throw new Error("Failed to restore version"); }
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function WordDiff({ a, b }: { a: string; b: string }) {
  const parts = diffWords(a, b);
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed p-4 bg-muted/30 rounded-lg border overflow-auto max-h-[60vh]">
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            part.added
              ? "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200 rounded px-0.5"
              : part.removed
              ? "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200 rounded px-0.5 line-through opacity-70"
              : ""
          }
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}

export default function ArticleHistory({ params }: { params?: { slug?: string; userId?: string; logSlug?: string; projectId?: string } }) {
  const userId = Number(params?.userId);
  const logSlug = params?.logSlug;
  const projectId = Number(params?.projectId);
  const isProjectDocument = Number.isSafeInteger(projectId) && projectId > 0;
  const isLogRoute = Number.isSafeInteger(userId) && userId > 0 && Boolean(logSlug);
  const { data: logArticle, isLoading: isLoadingLog } = useQuery<{ slug: string }>({
    queryKey: ["log-entry-for-history", userId, logSlug],
    queryFn: () => fetch(`/api/logs/${userId}/${logSlug}`, { credentials: "include" }).then((r) => {
      if (!r.ok) throw new Error("Failed to load log entry");
      return r.json();
    }),
    enabled: isLogRoute,
    retry: false,
  });
  const slug = isLogRoute ? (logArticle?.slug ?? "") : (params?.slug ?? "");
  const articlePath = isLogRoute
    ? `/logs/${userId}/${logSlug}`
    : isProjectDocument
      ? `/projects/${projectId}/documents/${slug}`
      : `/knowledge/${slug}`;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: articlePermission } = useQuery<{ canEdit?: boolean }>({
    queryKey: ["article-history-permissions", slug],
    queryFn: async () => {
      const response = await fetch(`/api/articles/${slug}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load document permissions");
      return response.json();
    },
    enabled: !!slug,
    retry: false,
  });
  const canEdit = Boolean(articlePermission?.canEdit);

  const { data: versions, isLoading } = useQuery({
    queryKey: ["article-versions", slug],
    queryFn: () => fetchVersions(slug),
    enabled: !!slug && !isLoadingLog,
  });

  const [viewingId, setViewingId] = useState<number | null>(null);
  const [compareIds, setCompareIds] = useState<[number, number] | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<number[]>([]);

  const { data: viewingVersion, isLoading: loadingView } = useQuery({
    queryKey: ["article-version", slug, viewingId],
    queryFn: () => fetchVersion(slug, viewingId!),
    enabled: viewingId !== null,
  });

  const { data: compareA, isLoading: loadingA } = useQuery({
    queryKey: ["article-version", slug, compareIds?.[0]],
    queryFn: () => fetchVersion(slug, compareIds![0]),
    enabled: compareIds !== null,
  });

  const { data: compareB, isLoading: loadingB } = useQuery({
    queryKey: ["article-version", slug, compareIds?.[1]],
    queryFn: () => fetchVersion(slug, compareIds![1]),
    enabled: compareIds !== null,
  });

  const restoreMutation = useMutation({
    mutationFn: (versionId: number) => restoreVersion(slug, versionId),
    onSuccess: () => {
      toast({ title: "Version restored", description: "The article has been restored to that version." });
      queryClient.invalidateQueries({ queryKey: ["article-versions", slug] });
      queryClient.invalidateQueries({ queryKey: ["getArticle", slug] });
          setLocation(articlePath);
    },
    onError: (err) =>
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" }),
  });

  const toggleCompareSelect = (id: number) => {
    setSelectedForCompare((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const latestVersionNumber = versions?.[0]?.versionNumber ?? 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation(articlePath)}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to article
        </Button>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-2">
            <Clock className="h-7 w-7" />
            Version History
          </h1>
          <p className="text-muted-foreground mt-1">
            {versions?.length ?? 0} saved version{versions?.length !== 1 ? "s" : ""}
            {versions && versions.length > 0 && (
              <> &mdash; article: <strong className="text-foreground">{versions[0].title}</strong></>
            )}
          </p>
        </div>
        {selectedForCompare.length === 2 && (
          <Button
            onClick={() => {
              const sorted = [...selectedForCompare].sort((a, b) => a - b) as [number, number];
              setCompareIds(sorted);
              setViewingId(null);
            }}
          >
            <GitCompare className="mr-2 h-4 w-4" />
            Compare {selectedForCompare.length} versions
          </Button>
        )}
        {selectedForCompare.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSelectedForCompare([])}>
            <X className="h-4 w-4 mr-1" /> Clear selection
          </Button>
        )}
      </div>

      {/* Compare diff panel */}
      {compareIds && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <GitCompare className="h-4 w-4" />
                {loadingA || loadingB
                  ? "Loading comparison…"
                  : compareA && compareB
                  ? `Comparing v${Math.min(compareA.versionNumber, compareB.versionNumber)} → v${Math.max(compareA.versionNumber, compareB.versionNumber)}`
                  : "Comparison"}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setCompareIds(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingA || loadingB ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : compareA && compareB ? (
              <div className="space-y-3">
                <div className="flex gap-6 text-xs text-muted-foreground">
                  <span>
                    <span className="inline-block w-3 h-3 rounded bg-red-200 dark:bg-red-900/40 mr-1" />
                    Removed in v{Math.max(compareA.versionNumber, compareB.versionNumber)}
                  </span>
                  <span>
                    <span className="inline-block w-3 h-3 rounded bg-green-200 dark:bg-green-900/40 mr-1" />
                    Added in v{Math.max(compareA.versionNumber, compareB.versionNumber)}
                  </span>
                </div>
                <WordDiff
                  a={stripHtml(compareA.versionNumber < compareB.versionNumber ? compareA.content : compareB.content)}
                  b={stripHtml(compareA.versionNumber < compareB.versionNumber ? compareB.content : compareA.content)}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Version preview panel */}
      {viewingId && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="h-4 w-4" />
                {loadingView ? "Loading…" : viewingVersion ? `Preview: v${viewingVersion.versionNumber} — ${viewingVersion.title}` : "Preview"}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setViewingId(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingView ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : viewingVersion ? (
              <div
                className="prose prose-stone dark:prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary prose-img:rounded-lg prose-table:border-collapse prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-2 prose-th:bg-muted max-h-[60vh] overflow-auto"
                dangerouslySetInnerHTML={{ __html: viewingVersion.content }}
              />
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Version list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !versions || versions.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Clock className="h-10 w-10 mx-auto opacity-30 mb-3" />
          <p className="text-sm">No version history yet.</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/50 uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium w-8">
                      <span className="sr-only">Compare select</span>
                    </th>
                    <th className="px-4 py-3 font-medium text-left">Version</th>
                    <th className="px-4 py-3 font-medium text-left">Title</th>
                    <th className="px-4 py-3 font-medium text-left">Saved by</th>
                    <th className="px-4 py-3 font-medium text-left">Date</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => {
                    const isCurrent = v.versionNumber === latestVersionNumber;
                    const isViewing = viewingId === v.id;
                    const isSelected = selectedForCompare.includes(v.id);
                    return (
                      <tr
                        key={v.id}
                        className={`border-b last:border-0 transition-colors ${isViewing ? "bg-primary/5" : isSelected ? "bg-amber-50 dark:bg-amber-900/10" : "hover:bg-muted/30"}`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleCompareSelect(v.id)}
                            className="rounded border-border"
                            title="Select for comparison"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium">v{v.versionNumber}</span>
                            {isCurrent && (
                              <Badge variant="default" className="text-xs px-1.5 py-0">
                                Current
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-xs truncate text-foreground">{v.title}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {v.createdByName ?? <span className="italic opacity-60">Unknown</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          <span title={format(new Date(v.createdAt), "MMMM d, yyyy 'at' h:mm a")}>
                            {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant={isViewing ? "secondary" : "ghost"}
                              size="sm"
                              onClick={() => {
                                setViewingId(isViewing ? null : v.id);
                                setCompareIds(null);
                              }}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              {isViewing ? "Hide" : "View"}
                            </Button>
                            {!isCurrent && canEdit && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-primary hover:text-primary"
                                    disabled={restoreMutation.isPending}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                    Restore
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Restore v{v.versionNumber}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will overwrite the current article with the content from{" "}
                                      <strong>v{v.versionNumber}</strong> saved{" "}
                                      {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}.
                                      A new version entry will be created so this action can be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => restoreMutation.mutate(v.id)}>
                                      Restore this version
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
