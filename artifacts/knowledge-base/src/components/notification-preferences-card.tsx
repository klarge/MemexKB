import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetNotificationPreferences,
  useUpdateNotificationPreferences,
  getGetNotificationPreferencesQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, Loader2, TriangleAlert, Check } from "lucide-react";

const HOURS = [
  { value: 1, label: "1 hour before" },
  { value: 24, label: "24 hours before" },
  { value: 48, label: "48 hours before" },
  { value: 72, label: "72 hours before" },
  { value: 168, label: "1 week before" },
] as const;

type Hours = (typeof HOURS)[number]["value"];
type Prefs = { cardAssigned: boolean; projectAdded: boolean; cardDue: boolean; dueSoonHours: Hours };
const DEFAULTS: Prefs = { cardAssigned: false, projectAdded: false, cardDue: false, dueSoonHours: 24 };

export function NotificationPreferencesCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useGetNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const [form, setForm] = useState<Prefs>(DEFAULTS);
  const [saved, setSaved] = useState<Prefs>(DEFAULTS);
  const [justSaved, setJustSaved] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (data && !initialized.current) {
      initialized.current = true;
      const p: Prefs = {
        cardAssigned: data.cardAssigned,
        projectAdded: data.projectAdded,
        cardDue: data.cardDue,
        dueSoonHours: data.dueSoonHours,
      };
      setForm(p);
      setSaved(p);
    }
  }, [data]);

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setJustSaved(false);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const save = () => {
    update.mutate(
      { data: form },
      {
        onSuccess: (res) => {
          const p: Prefs = {
            cardAssigned: res.cardAssigned,
            projectAdded: res.projectAdded,
            cardDue: res.cardDue,
            dueSoonHours: res.dueSoonHours,
          };
          setForm(p);
          setSaved(p);
          setJustSaved(true);
          toast({ title: "Notification preferences saved" });
          void queryClient.invalidateQueries({ queryKey: getGetNotificationPreferencesQueryKey() });
        },
        onError: (err) =>
          toast({ title: "Failed to save preferences", description: err.message, variant: "destructive" }),
      },
    );
  };

  const rows: { key: "cardAssigned" | "projectAdded" | "cardDue"; title: string; desc: string }[] = [
    { key: "cardAssigned", title: "Card assigned to me", desc: "Email me when someone assigns me a board card." },
    { key: "projectAdded", title: "Added to a project", desc: "Email me when I am added to a project." },
    { key: "cardDue", title: "Card due soon", desc: "Email me before a card assigned to me is due." },
  ];

  return (
    <Card data-testid="card-notification-preferences">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Email Notifications
        </CardTitle>
        <CardDescription>
          Choose which events send you an email{user?.email ? <> at <span className="font-medium text-foreground" data-testid="text-notification-email">{user.email}</span></> : null}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3" data-testid="skeleton-notification-preferences">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError || !data ? (
          <div className="rounded-md border border-destructive/40 p-4 space-y-3">
            <p className="text-sm text-destructive">Could not load your notification preferences.</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching} data-testid="button-retry-preferences">
              {isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Retry
            </Button>
          </div>
        ) : (
          <>
            {!data.emailAvailable && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-amber-800 dark:text-amber-300" data-testid="notice-email-unavailable">
                <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
                <p className="text-sm">
                  Email delivery has not been set up by an administrator yet. You can still save your preferences; emails will be sent once it is configured.
                </p>
              </div>
            )}
            <div className="divide-y divide-border rounded-md border border-border">
              {rows.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-4 px-3 py-3">
                  <label htmlFor={`pref-${r.key}`} className="flex-1 cursor-pointer">
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.desc}</p>
                  </label>
                  <Switch id={`pref-${r.key}`} checked={form[r.key]} onCheckedChange={(v) => set(r.key, v)} data-testid={`switch-${r.key}`} />
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pref-due-soon-hours" className="text-sm font-medium">Due reminder timing</label>
              <select
                id="pref-due-soon-hours"
                value={form.dueSoonHours}
                disabled={!form.cardDue}
                onChange={(e) => set("dueSoonHours", Number(e.target.value) as Hours)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                data-testid="select-due-soon-hours"
              >
                {HOURS.map((h) => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Applies only when due-soon emails are on.</p>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={update.isPending || !dirty} data-testid="button-save-preferences">
                {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save preferences
              </Button>
              {justSaved && !dirty && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground" data-testid="status-preferences-saved">
                  <Check className="h-4 w-4 text-green-600" /> Saved
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
