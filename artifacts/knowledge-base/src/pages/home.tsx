import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useSiteSettings } from "@/lib/site-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BookOpen,
  Library,
  Clock,
  ArrowRight,
  FileText,
  AlertCircle,
  Pencil,
  Plus,
  Loader2,
  Search,
  X,
  ScrollText,
  ListTodo,
  Calendar,
  FolderKanban,
  CheckSquare,
  KanbanSquare,
} from "lucide-react";
import { formatDistanceToNow, format, isPast, isToday } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type ArticleSummary = {
  id: number;
  slug: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  updatedByName: string | null;
};

type StatsData = {
  totalArticles: number;
  recentlyUpdated: ArticleSummary[];
  oldestUpdated: ArticleSummary[];
};

type LogEntry = {
  id: number;
  slug: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type SearchResult = {
  id: number;
  slug: string;
  title: string;
  updatedAt: string;
  updatedByName: string | null;
};

type TaskSearchResult = {
  id: number;
  title: string;
  updatedAt: string;
  listName: string | null;
};

type CardSearchResult = {
  id: number;
  title: string;
  updatedAt: string;
  projectId: number;
  boardId: number;
  boardName: string | null;
  projectName: string | null;
};

type SearchResults = {
  articles: SearchResult[];
  logEntries: SearchResult[];
  tasks: TaskSearchResult[];
  cards: CardSearchResult[];
};

type ActiveTask = {
  id: number;
  title: string;
  listId: number;
  listName: string;
};

type UpcomingCard = {
  id: number;
  title: string;
  dueDate: string | null;
  boardId: number;
  boardName: string;
  projectId: number;
  projectName: string;
  columnName: string;
};

type DashboardData = {
  activeTasks: ActiveTask[];
  upcomingCards: UpcomingCard[];
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function ArticleRow({ article, accent }: { article: ArticleSummary; accent?: boolean }) {
  return (
    <Link href={`/knowledge/${article.slug}`}>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer">
        <FileText className={`h-4 w-4 shrink-0 ${accent ? "text-amber-500" : "text-muted-foreground"}`} />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{article.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDistanceToNow(new Date(article.updatedAt), { addSuffix: true })}
            {article.updatedByName && ` · ${article.updatedByName}`}
          </p>
        </div>
      </div>
    </Link>
  );
}

function SectionShell({
  icon,
  title,
  viewAllHref,
  viewAllLabel = "View all",
  action,
  loading,
  empty,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  viewAllHref: string;
  viewAllLabel?: string;
  action?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">{title}</h2>
        </div>
        <div className="flex items-center gap-1">
          {action}
          <Link href={viewAllHref}>
            <Button variant="ghost" size="sm" className="text-muted-foreground gap-1">
              {viewAllLabel} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>
      <div className="rounded-lg border bg-card divide-y divide-border overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : empty ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Nothing here yet.</div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function SearchResultRow({ result, icon }: { result: SearchResult; icon: React.ReactNode }) {
  return (
    <Link href={`/knowledge/${result.slug}`}>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer">
        <div className="shrink-0 text-muted-foreground">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{result.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Updated {formatDistanceToNow(new Date(result.updatedAt), { addSuffix: true })}
            {result.updatedByName && ` · ${result.updatedByName}`}
          </p>
        </div>
      </div>
    </Link>
  );
}

function logHref(result: { logOwnerId?: number | null; logSlug?: string | null; slug: string }) {
  return result.logOwnerId && result.logSlug ? `/logs/${result.logOwnerId}/${result.logSlug}` : `/knowledge/${result.slug}`;
}

function DueDateBadge({ dueDate }: { dueDate: string }) {
  const d = new Date(dueDate);
  const overdue = isPast(d) && !isToday(d);
  const today = isToday(d);
  return (
    <span
      className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded ${
        overdue
          ? "bg-destructive/10 text-destructive"
          : today
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {overdue ? "Overdue · " : today ? "Today · " : ""}
      {format(d, "MMM d")}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: siteSettings } = useSiteSettings();

  const canEdit = user?.role === "admin" || user?.role === "editor";
  const logEnabled = siteSettings?.logEntriesEnabled === true;
  const tasksEnabled = siteSettings?.tasksEnabled !== false;
  const projectsEnabled = siteSettings?.projectsEnabled !== false;

  // ── Search state ──────────────────────────────────────────────────────────
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(rawQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [rawQuery]);

  const searching = debouncedQuery.length >= 2;

  const { data: searchData, isFetching: searchFetching } = useQuery<SearchResults>({
    queryKey: ["home-search", debouncedQuery],
    queryFn: () =>
      fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`).then((r) => r.json()),
    enabled: searching,
    staleTime: 30_000,
  });

  const hasResults =
    searchData &&
    (searchData.articles.length > 0 ||
      searchData.logEntries.length > 0 ||
      (searchData.tasks ?? []).length > 0 ||
      (searchData.cards ?? []).length > 0);
  const noResults = searching && !searchFetching && searchData && !hasResults;

  // ── Dashboard data ────────────────────────────────────────────────────────
  const { data: stats, isLoading: statsLoading } = useQuery<StatsData>({
    queryKey: ["articles-stats"],
    queryFn: () => fetch("/api/articles/stats").then((r) => r.json()),
  });

  const { data: logData, isLoading: logLoading } = useQuery<{ entries: LogEntry[]; total: number; hasMore: boolean }>({
    // Separate key from the full log page so they don't share cache with different offsets.
    queryKey: ["log-entries-home"],
    queryFn: () => fetch("/api/log?limit=3").then((r) => r.json()),
    enabled: logEnabled,
    staleTime: 60_000,
  });

  const { data: dashboard, isLoading: dashboardLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: () => fetch("/api/dashboard").then((r) => r.json()),
    staleTime: 60_000,
  });

  const recentLogs = (logData?.entries ?? []).slice(0, 3);
  const todayTitle = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const todayEntry = (logData?.entries ?? []).find((e) => e.title === todayTitle);

  const handleTodayLog = () => {
    setLocation(todayEntry ? `${logHref(todayEntry)}/edit` : "/knowledge/new?log=1");
  };

  const activeTasks = (dashboard?.activeTasks ?? []).slice(0, 5);
  const upcomingCards = (dashboard?.upcomingCards ?? []).slice(0, 5);

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Page header + search */}
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome back{user?.name ? `, ${user.name}` : ""}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Here's what's been happening in your knowledge base.
          </p>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search articles, tasks, and project cards…"
            className="pl-9 pr-9 h-10 text-sm"
          />
          {rawQuery && !searchFetching && (
            <button
              type="button"
              onClick={() => {
                setRawQuery("");
                setDebouncedQuery("");
                inputRef.current?.focus();
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {searchFetching && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {/* ── Search results ── */}
      {searching && (
        <div className="space-y-6">
          {searchFetching && !searchData && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {noResults && (
            <div className="rounded-lg border bg-card py-12 text-center text-sm text-muted-foreground">
              No results for <span className="font-medium text-foreground">"{debouncedQuery}"</span>
            </div>
          )}

          {searchData && searchData.articles.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Library className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Articles</h2>
                <span className="ml-1 text-xs text-muted-foreground tabular-nums">({searchData.articles.length})</span>
              </div>
              <div className="rounded-lg border bg-card divide-y divide-border overflow-hidden">
                {searchData.articles.map((r) => (
                  <SearchResultRow key={r.id} result={r} icon={<FileText className="h-4 w-4" />} />
                ))}
              </div>
            </section>
          )}

          {searchData && searchData.logEntries.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Log Entries</h2>
                <span className="ml-1 text-xs text-muted-foreground tabular-nums">({searchData.logEntries.length})</span>
              </div>
              <div className="rounded-lg border bg-card divide-y divide-border overflow-hidden">
                {searchData.logEntries.map((r) => (
                  <Link key={r.id} href={logHref(r)}>
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer">
                      <div className="shrink-0 text-muted-foreground"><ScrollText className="h-4 w-4" /></div>
                      <div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{r.title}</p></div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {searchData && (searchData.tasks ?? []).length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Tasks</h2>
                <span className="ml-1 text-xs text-muted-foreground tabular-nums">({searchData.tasks.length})</span>
              </div>
              <div className="rounded-lg border bg-card divide-y divide-border overflow-hidden">
                {searchData.tasks.map((t) => (
                  <Link key={t.id} href="/tasks">
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer">
                      <div className="shrink-0 text-muted-foreground">
                        <CheckSquare className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{t.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t.listName && <span>{t.listName} · </span>}
                          Updated {formatDistanceToNow(new Date(t.updatedAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {searchData && (searchData.cards ?? []).length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <KanbanSquare className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Project Cards</h2>
                <span className="ml-1 text-xs text-muted-foreground tabular-nums">({searchData.cards.length})</span>
              </div>
              <div className="rounded-lg border bg-card divide-y divide-border overflow-hidden">
                {searchData.cards.map((c) => (
                  <Link key={c.id} href={`/projects/${c.projectId}/boards/${c.boardId}`}>
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer">
                      <div className="shrink-0 text-muted-foreground">
                        <KanbanSquare className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{c.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {c.projectName && <span>{c.projectName}{c.boardName ? ` · ${c.boardName}` : ""} · </span>}
                          Updated {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── Dashboard (hidden while searching) ── */}
      {!searching && (
        <>
          {/* Log section */}
          {logEnabled && (
            <SectionShell
              icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
              title="Recent Log"
              viewAllHref="/log"
              viewAllLabel="View all"
              loading={logLoading}
              empty={!logLoading && recentLogs.length === 0}
              action={
                canEdit ? (
                  <Button size="sm" onClick={handleTodayLog} className="gap-1.5">
                    {todayEntry ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    {todayEntry ? "Edit Today's Entry" : "Today's Log"}
                  </Button>
                ) : undefined
              }
            >
              {recentLogs.map((entry) => (
                <Link key={entry.id} href={logHref(entry)}>
                  <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer">
                    <div className="shrink-0 text-center w-10">
                      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-none">
                        {format(new Date(entry.createdAt), "MMM")}
                      </div>
                      <div className="text-xl font-bold tabular-nums leading-tight">
                        {format(new Date(entry.createdAt), "d")}
                      </div>
                    </div>
                    <div className="w-px h-8 bg-border shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{entry.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Updated {formatDistanceToNow(new Date(entry.updatedAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </SectionShell>
          )}

          {/* Active tasks + Upcoming cards — side by side on wider screens */}
          {(tasksEnabled || projectsEnabled) && (
            <div className="grid gap-6 md:grid-cols-2">
              {tasksEnabled && (
                <SectionShell
                  icon={<ListTodo className="h-4 w-4 text-muted-foreground" />}
                  title="My Active Tasks"
                  viewAllHref="/tasks"
                  viewAllLabel="All tasks"
                  loading={dashboardLoading}
                  empty={!dashboardLoading && activeTasks.length === 0}
                >
                  {activeTasks.map((task) => (
                    <Link key={task.id} href="/tasks">
                      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer">
                        <div className="shrink-0 h-4 w-4 rounded-full border-2 border-muted-foreground/40" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{task.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.listName}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </SectionShell>
              )}

              {projectsEnabled && (
                <SectionShell
                  icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
                  title="Upcoming Due Dates"
                  viewAllHref="/projects"
                  viewAllLabel="All projects"
                  loading={dashboardLoading}
                  empty={!dashboardLoading && upcomingCards.length === 0}
                >
                  {upcomingCards.map((card) => (
                    <Link key={card.id} href={`/projects/${card.projectId}/boards/${card.boardId}`}>
                      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer">
                        <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{card.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {card.projectName} · {card.columnName}
                          </p>
                        </div>
                        {card.dueDate && <DueDateBadge dueDate={card.dueDate} />}
                      </div>
                    </Link>
                  ))}
                </SectionShell>
              )}
            </div>
          )}

          {/* Article sections */}
          <div className="grid gap-6 md:grid-cols-2">
            <SectionShell
              icon={<Clock className="h-4 w-4 text-muted-foreground" />}
              title="Recently Updated"
              viewAllHref="/knowledge"
              viewAllLabel="Browse all"
              loading={statsLoading}
              empty={!statsLoading && (stats?.recentlyUpdated ?? []).length === 0}
            >
              {(stats?.recentlyUpdated ?? []).slice(0, 5).map((a) => (
                <ArticleRow key={a.id} article={a} />
              ))}
            </SectionShell>

            <SectionShell
              icon={<AlertCircle className="h-4 w-4 text-muted-foreground" />}
              title="Needs Review"
              viewAllHref="/knowledge"
              viewAllLabel="View all"
              loading={statsLoading}
              empty={!statsLoading && (stats?.oldestUpdated ?? []).length === 0}
            >
              {(stats?.oldestUpdated ?? []).slice(0, 5).map((a) => (
                <ArticleRow key={a.id} article={a} accent />
              ))}
            </SectionShell>
          </div>
        </>
      )}
    </div>
  );
}
