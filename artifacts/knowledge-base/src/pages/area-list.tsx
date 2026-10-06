import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useListPolicySubjects, type ListArticlesParams } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useSiteSettings } from "@/lib/site-settings";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ChevronRight, FolderTree, Lock, ListChecks, Plus, ScrollText, Search } from "lucide-react";
import { format } from "date-fns";
import { AREA_BASE, AREA_KIND } from "@/lib/content-paths";
import { flattenSubjects } from "@/lib/policy-subjects";
import { useContentArticles } from "@/hooks/use-content-articles";
import { LoadMore } from "@/components/load-more";
import { FavoriteButton } from "@/components/favorite-button";

type Area = "policies" | "procedures";

export default function AreaList({ area }: { area: Area }) {
  const kind = AREA_KIND[area];
  const isPolicy = area === "policies";
  const title = isPolicy ? "Policies" : "Procedures";
  const Icon = isPolicy ? ScrollText : ListChecks;
  const { user } = useAuth();
  const { data: settings } = useSiteSettings();
  const [, setLocation] = useLocation();
  const queryString = useSearch();
  const subjectParam = Number(new URLSearchParams(queryString).get("subject"));
  const selectedSubjectId = Number.isSafeInteger(subjectParam) && subjectParam > 0 ? subjectParam : null;
  const [search, setSearch] = useState("");
  const canAuthor = user?.role === "admin" || user?.role === "editor";
  const enabled = isPolicy ? settings?.policiesEnabled : settings?.proceduresEnabled;

  const searchTerm = search.trim();
  // subjectId is filtered server-side (descendants included) so pagination stays accurate.
  const listParams: ListArticlesParams = {
    kind,
    sort: isPolicy ? "title" : "updated_at",
    order: isPolicy ? "asc" : "desc",
    ...(searchTerm ? { search: searchTerm } : {}),
    ...(isPolicy && selectedSubjectId ? { subjectId: selectedSubjectId } : {}),
  };
  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError } = useContentArticles(listParams);
  const { data: subjects = [] } = useListPolicySubjects({ query: { enabled: isPolicy, queryKey: ["/api/policy-subjects"] } });

  const flat = useMemo(() => flattenSubjects(subjects), [subjects]);
  const selectedPath = useMemo(
    () => (selectedSubjectId ? flat.find((n) => n.subject.id === selectedSubjectId)?.path ?? [] : []),
    [flat, selectedSubjectId],
  );
  const articles = data?.articles ?? [];
  const total = data?.total ?? articles.length;

  const goSubject = (id: number | null) => setLocation(id ? `${AREA_BASE[area]}?subject=${id}` : AREA_BASE[area]);

  const row = (a: (typeof articles)[number]) => (
    <Link key={a.id} href={`${AREA_BASE[area]}/${a.slug}`}>
      <Card className="hover-elevate cursor-pointer transition-colors group" data-testid={`card-${kind}-${a.id}`}>
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <FavoriteButton entityType="article" entityId={a.id} title={a.title} />
          <div className="min-w-0 flex items-center gap-3">
            <div className="h-9 w-9 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">
              {a.isRestricted ? <Lock className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold group-hover:text-primary transition-colors truncate">{a.title}</h3>
              <p className="text-xs text-muted-foreground">
                Updated {format(new Date(a.updatedAt), "MMM d, yyyy")}
                {a.updatedByName ? ` by ${a.updatedByName}` : ""}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs border-primary/20 text-primary bg-primary/5">
            {a.visibility === "group" ? "Group" : a.visibility === "public" ? "Public" : "Personal"}
          </Badge>
        </CardContent>
      </Card>
    </Link>
  );

  // Group policies by subject (in tree order); entries with unknown subject go last.
  const groups = useMemo(() => {
    if (!isPolicy) return [];
    const out: { key: string; label: string; items: typeof articles }[] = [];
    for (const n of flat) {
      const items = articles.filter((a) => a.policySubjectId === n.subject.id);
      if (items.length) out.push({ key: String(n.subject.id), label: n.path.map((p) => p.name).join(" / "), items });
    }
    const known = new Set(flat.map((n) => n.subject.id));
    const rest = articles.filter((a) => a.policySubjectId == null || !known.has(a.policySubjectId));
    if (rest.length) out.push({ key: "none", label: "Uncategorized", items: rest });
    return out;
  }, [isPolicy, flat, articles]);

  const childSubjects = subjects
    .filter((s) => (selectedSubjectId ? s.parentId === selectedSubjectId : s.parentId === null))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid={`heading-${area}`}>
            <Icon className="h-6 w-6" /> {title}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isPolicy
              ? "Standing rules, organized by category. Policies are reference documents, not a sequence."
              : "Repeatable processes. Run a procedure to turn its steps into a project."}
          </p>
        </div>
        {canAuthor && (
          <Button onClick={() => setLocation(`${AREA_BASE[area]}/new`)} data-testid={`button-new-${kind}`}>
            <Plus className="mr-2 h-4 w-4" /> New {isPolicy ? "Policy" : "Procedure"}
          </Button>
        )}
      </div>

      {settings && !enabled && (
        <div className="flex items-center gap-2 border border-dashed rounded-md px-4 py-3 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {title} is hidden from the sidebar. Existing documents remain available at this address.
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder={`Search ${title.toLowerCase()}...`} value={search} onChange={(e) => setSearch(e.target.value)} data-testid={`input-search-${area}`} />
      </div>

      {isPolicy && (
        <div className="space-y-3">
          <nav aria-label="Category breadcrumb" className="flex items-center flex-wrap gap-1 text-sm" data-testid="breadcrumb-policy-category">
            <button type="button" className={`hover:text-primary ${selectedSubjectId ? "text-muted-foreground" : "font-semibold"}`} onClick={() => goSubject(null)}>
              All categories
            </button>
            {selectedPath.map((p, i) => (
              <span key={p.id} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                <button type="button" className={`hover:text-primary ${i === selectedPath.length - 1 ? "font-semibold" : "text-muted-foreground"}`} onClick={() => goSubject(p.id)}>
                  {p.name}
                </button>
              </span>
            ))}
          </nav>
          {childSubjects.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {childSubjects.map((s) => (
                <Button key={s.id} variant="outline" size="sm" onClick={() => goSubject(s.id)} data-testid={`button-subject-${s.id}`}>
                  <FolderTree className="mr-2 h-3.5 w-3.5" /> {s.name}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg border border-border/50" />)}
        </div>
      ) : isError ? (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-3">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground">Could not load {title.toLowerCase()}.</p>
            <Button variant="outline" onClick={() => refetch()}>Try again</Button>
          </CardContent>
        </Card>
      ) : articles.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-48 text-center">
            <Icon className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg">No {title.toLowerCase()} here yet</h3>
            <p className="text-muted-foreground">{canAuthor ? `Create the first ${isPolicy ? "policy" : "procedure"} to get started.` : "Nothing has been shared with you yet."}</p>
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && !isError && articles.length > 0 && (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground" data-testid="pagination">
          <span data-testid="text-total">
            Showing {articles.length} of {total}
          </span>
        </div>
      )}

      {isLoading || isError || articles.length === 0 ? null : isPolicy ? (
        <div className="space-y-6" data-testid="list-policies">
          {groups.map((g) => (
            <section key={g.key} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h2>
              <div className="grid gap-2">{g.items.map(row)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid gap-2" data-testid="list-procedures">{articles.map(row)}</div>
      )}
      <LoadMore hasMore={hasNextPage} onClick={() => { void fetchNextPage(); }}
        loading={isFetchingNextPage} error={isFetchNextPageError} />
    </div>
  );
}
