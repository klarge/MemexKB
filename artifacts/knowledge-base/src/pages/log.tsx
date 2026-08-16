import { useLocation, Link, Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, BookOpen } from "lucide-react";
import { format } from "date-fns";
import { useSiteSettings } from "@/lib/site-settings";

type LogEntry = {
  id: number;
  slug: string;
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

  const { data, isLoading } = useQuery<{ entries: LogEntry[]; total: number }>({
    queryKey: ["log-entries"],
    queryFn: () => fetch("/api/log").then((r) => r.json()),
    enabled: siteSettings?.logEntriesEnabled === true,
  });

  // Redirect to home if the feature is disabled
  if (!settingsLoading && siteSettings && !siteSettings.logEntriesEnabled) {
    return <Redirect to="/" />;
  }

  const entries = data?.entries ?? [];

  // Check if today's entry already exists
  const todayTitle = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const todayEntry = entries.find((e) => e.title === todayTitle);

  const handleNewEntry = () => {
    if (todayEntry) {
      setLocation(`/wiki/${todayEntry.slug}/edit`);
    } else {
      setLocation("/wiki/new?log=1");
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
          <Button onClick={handleNewEntry}>
            <Plus className="mr-2 h-4 w-4" />
            {todayEntry ? "Edit Today's Entry" : "New Entry"}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="mx-auto h-10 w-10 opacity-20 mb-3" />
          <p className="font-medium">No log entries yet</p>
          {canEdit && (
            <p className="text-sm mt-1">Click "New Entry" to start the log.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <Link key={entry.id} href={`/wiki/${entry.slug}`}>
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
        </div>
      )}
    </div>
  );
}
