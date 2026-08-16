import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useSiteSettings } from "@/lib/site-settings";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

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

function ArticleRow({ article, accent }: { article: ArticleSummary; accent?: boolean }) {
  return (
    <Link href={`/wiki/${article.slug}`}>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer">
        <FileText
          className={`h-4 w-4 shrink-0 ${accent ? "text-amber-500" : "text-muted-foreground"}`}
        />
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
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            {title}
          </h2>
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

export default function Home() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: siteSettings } = useSiteSettings();

  const canEdit = user?.role === "admin" || user?.role === "editor";
  const logEnabled = siteSettings?.logEntriesEnabled === true;

  const { data: stats, isLoading: statsLoading } = useQuery<StatsData>({
    queryKey: ["articles-stats"],
    queryFn: () => fetch("/api/articles/stats").then((r) => r.json()),
  });

  const { data: logData, isLoading: logLoading } = useQuery<{
    entries: LogEntry[];
    total: number;
  }>({
    queryKey: ["log-entries"],
    queryFn: () => fetch("/api/log").then((r) => r.json()),
    enabled: logEnabled,
  });

  const recentLogs = (logData?.entries ?? []).slice(0, 3);
  const todayTitle = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const todayEntry = (logData?.entries ?? []).find((e) => e.title === todayTitle);

  const handleTodayLog = () => {
    setLocation(todayEntry ? `/wiki/${todayEntry.slug}/edit` : "/wiki/new?log=1");
  };

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back{user?.name ? `, ${user.name}` : ""}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Here's what's been happening in your knowledge base.
        </p>
      </div>

      {/* Log section — only shown when the feature is enabled */}
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
                {todayEntry ? (
                  <Pencil className="h-3.5 w-3.5" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {todayEntry ? "Edit Today's Entry" : "Today's Log"}
              </Button>
            ) : undefined
          }
        >
          {recentLogs.map((entry) => (
            <Link key={entry.id} href={`/wiki/${entry.slug}`}>
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

      {/* Article sections side-by-side on wider screens */}
      <div className="grid gap-6 md:grid-cols-2">
        <SectionShell
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          title="Recently Updated"
          viewAllHref="/knowledge"
          viewAllLabel="Browse all"
          loading={statsLoading}
          empty={!statsLoading && (stats?.recentlyUpdated ?? []).length === 0}
        >
          {(stats?.recentlyUpdated ?? []).map((a) => (
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
          {(stats?.oldestUpdated ?? []).map((a) => (
            <ArticleRow key={a.id} article={a} accent />
          ))}
        </SectionShell>
      </div>
    </div>
  );
}
