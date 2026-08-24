import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, Link, Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, Plus, BookOpen } from "lucide-react";
import { format } from "date-fns";
import { useSiteSettings } from "@/lib/site-settings";

const PAGE_SIZE = 50;

type LogEntry = {
  id: number;
  slug: string;
  logSlug: string;
  logOwnerId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  updatedByName: string | null;
};

export default function LogPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "editor";
  const { data: siteSettings, isLoading: settingsLoading } = useSiteSettings();

  const [offset, setOffset] = useState(0);
  // Accumulated entries across all pages
  const [allEntries, setAllEntries] = useState<LogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [schemaOutOfDate, setSchemaOutOfDate] = useState(false);
  // Prevent double-accumulation on StrictMode double-effects
  const lastMergedOffset = useRef(-1);

  const { data: page, isLoading, isFetching, isError, error, refetch } = useQuery<{
    entries: LogEntry[];
    total: number;
    hasMore: boolean;
    schemaOutOfDate?: boolean;
  }>({
    queryKey: ["log-entries", offset],
    queryFn: async () => {
      const response = await fetch(`/api/log?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!response.ok) {
        throw new Error("Could not load log entries. Please try again.");
      }
      return response.json();
    },
    enabled: siteSettings?.logEntriesEnabled === true,
    staleTime: 30_000,
  });

  // Merge each page into the accumulated list exactly once
  useEffect(() => {
    if (!page || lastMergedOffset.current === offset) return;
    lastMergedOffset.current = offset;
    setAllEntries((prev) => (offset === 0 ? page.entries : [...prev, ...page.entries]));
    setHasMore(page.hasMore);
    if (offset === 0) setSchemaOutOfDate(page.schemaOutOfDate === true);
  }, [page, offset]);

  const loadMore = useCallback(() => {
    setOffset((prev) => prev + PAGE_SIZE);
  }, []);

  // Redirect to home if the feature is disabled
  if (!settingsLoading && siteSettings && !siteSettings.logEntriesEnabled) {
    return <Redirect to="/" />;
  }

  // Check if today's entry already exists
  const todayTitle = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const todayEntry = allEntries.find((e) => e.title === todayTitle);

  const handleNewEntry = () => {
    if (todayEntry) {
      setLocation(`/logs/${todayEntry.logOwnerId}/${todayEntry.logSlug}/edit`);
    } else {
      setLocation("/knowledge/new?log=1");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6" />
            Logs
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            A running journal of dated entries.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={handleNewEntry}
            disabled={schemaOutOfDate}
            title={schemaOutOfDate ? "New entries are available after the log database update completes." : undefined}
          >
            <Plus className="mr-2 h-4 w-4" />
            {schemaOutOfDate ? "Log update in progress" : todayEntry ? "Edit Today's Entry" : "New Entry"}
          </Button>
        )}
      </div>

      {schemaOutOfDate && (
        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <p className="text-muted-foreground">
            Existing logs are available while their database update finishes. Adding or editing entries will be available again shortly.
          </p>
        </div>
      )}

      {isError && allEntries.length === 0 ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
          <AlertCircle className="mx-auto mb-3 h-9 w-9 text-destructive" />
          <h2 className="font-semibold">Could not load your logs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Please try again in a moment."}
          </p>
          <Button className="mt-4" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isLoading && allEntries.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : allEntries.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="mx-auto h-10 w-10 opacity-20 mb-3" />
          <p className="font-medium">No log entries yet</p>
          {canEdit && (
            <p className="text-sm mt-1">Click "New Entry" to start the log.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {allEntries.map((entry) => (
            <Link key={entry.id} href={`/logs/${entry.logOwnerId}/${entry.logSlug}`}>
              <div className="group flex items-center gap-5 rounded-lg border border-border bg-card px-5 py-4 hover:bg-muted/40 transition-colors cursor-pointer">
                {/* Date badge */}
                <div className="shrink-0 text-center w-12">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest leading-none">
                    {format(new Date(entry.createdAt), "MMM")}
                  </div>
                  <div className="text-3xl font-bold leading-tight tabular-nums">
                    {format(new Date(entry.createdAt), "d")}
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-none">
                    {format(new Date(entry.createdAt), "yyyy")}
                  </div>
                </div>

                <div className="w-px h-10 bg-border shrink-0" />

                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base leading-snug truncate group-hover:text-primary transition-colors">
                    {entry.title}
                  </h3>
                  {entry.updatedByName && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      by {entry.updatedByName}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          ))}

          {hasMore && !isError && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={loadMore} disabled={isFetching}>
                {isFetching ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading…</>
                ) : (
                  "Load more"
                )}
              </Button>
            </div>
          )}
          {isError && (
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
              <span className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" /> Could not load more log entries.
              </span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
