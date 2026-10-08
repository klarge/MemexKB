import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetNotificationSettings,
  useUpdateNotificationSettings,
  useTestNotificationEmail,
  getGetNotificationSettingsQueryKey,
  getGetNotificationPreferencesQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, Loader2, Send, Check, TriangleAlert } from "lucide-react";

type Security = "starttls" | "tls";
type Form = {
  enabled: boolean;
  host: string;
  port: string;
  security: Security;
  username: string;
  password: string;
  clearPassword: boolean;
  fromEmail: string;
  fromName: string;
  appUrl: string;
};

const EMPTY: Form = {
  enabled: false, host: "", port: "587", security: "starttls", username: "",
  password: "", clearPassword: false, fromEmail: "", fromName: "", appUrl: "",
};

function validUrl(v: string) {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function validate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  const port = Number(f.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) e.port = "Enter a port between 1 and 65535.";
  if (f.enabled) {
    if (!f.host.trim()) e.host = "SMTP host is required.";
    if (!f.fromEmail.trim()) e.fromEmail = "From address is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.fromEmail.trim())) e.fromEmail = "Enter a valid email address.";
    if (!f.appUrl.trim()) e.appUrl = "App URL is required.";
    else if (!validUrl(f.appUrl.trim())) e.appUrl = "Enter a full URL starting with http:// or https://.";
  } else if (f.appUrl.trim() && !validUrl(f.appUrl.trim())) {
    e.appUrl = "Enter a full URL starting with http:// or https://.";
  }
  return e;
}

export default function AdminNotifications() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useGetNotificationSettings();
  const update = useUpdateNotificationSettings();
  const test = useTestNotificationEmail();
  const [form, setForm] = useState<Form>(EMPTY);
  const [saved, setSaved] = useState<Form>(EMPTY);
  const [hasPassword, setHasPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [justSaved, setJustSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const initialized = useRef(false);

  const fromServer = (s: NonNullable<typeof data>): Form => ({
    enabled: s.enabled, host: s.host, port: String(s.port), security: s.security,
    username: s.username, password: "", clearPassword: false,
    fromEmail: s.fromEmail, fromName: s.fromName, appUrl: s.appUrl,
  });

  useEffect(() => {
    if (data && !initialized.current) {
      initialized.current = true;
      const f = fromServer(data);
      setForm(f);
      setSaved(f);
      setHasPassword(data.hasPassword);
    }
  }, [data]);

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setJustSaved(false);
    setTestResult(null);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const setSecurity = (s: Security) => {
    setJustSaved(false);
    setTestResult(null);
    setForm((f) => {
      const defaultsOld = f.security === "tls" ? "465" : "587";
      const port = f.port === defaultsOld || f.port === "" ? (s === "tls" ? "465" : "587") : f.port;
      return { ...f, security: s, port };
    });
  };

  const save = () => {
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    const hasNewPassword = form.password !== "";
    update.mutate(
      {
        data: {
          enabled: form.enabled,
          host: form.host.trim(),
          port: Number(form.port),
          security: form.security,
          username: form.username.trim(),
          ...(hasNewPassword ? { password: form.password } : {}),
          clearPassword: !hasNewPassword && form.clearPassword,
          fromEmail: form.fromEmail.trim(),
          fromName: form.fromName.trim(),
          appUrl: form.appUrl.trim(),
        },
      },
      {
        onSuccess: (res) => {
          const f = fromServer(res);
          setForm(f);
          setSaved(f);
          setHasPassword(res.hasPassword);
          setJustSaved(true);
          setTestResult(null);
          toast({ title: "Notification settings saved" });
          void queryClient.invalidateQueries({ queryKey: getGetNotificationSettingsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetNotificationPreferencesQueryKey() });
        },
        onError: (err) =>
          toast({ title: "Failed to save settings", description: err.message, variant: "destructive" }),
      },
    );
  };

  const sendTest = () => {
    setTestResult(null);
    test.mutate(undefined, {
      onSuccess: (res) => setTestResult({ ok: true, message: res.message || "Test email sent." }),
      onError: (err) => setTestResult({ ok: false, message: err.message || "The test email could not be sent." }),
    });
  };

  const err = (k: string) =>
    errors[k] ? <p className="text-xs text-destructive" data-testid={`error-${k}`}>{errors[k]}</p> : null;

  const canTest = !dirty && saved.enabled && !update.isPending && !test.isPending;

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Bell className="h-6 w-6" />
          Notifications
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure the outgoing email server used for project, card and due-date notifications.
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-4 pt-6" data-testid="skeleton-notification-settings">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </CardContent>
        </Card>
      ) : isError || !data ? (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm text-destructive">Could not load notification settings.</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} data-testid="button-retry-settings">
              {isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Email delivery</CardTitle>
              <CardDescription>
                When disabled, no notification emails are sent and fields may be left empty.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-3">
                <Switch id="smtp-enabled" checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} data-testid="switch-smtp-enabled" />
                <label htmlFor="smtp-enabled" className="text-sm cursor-pointer select-none">
                  {form.enabled ? "Enabled" : "Disabled"}
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="smtp-host">SMTP host</Label>
                  <Input id="smtp-host" value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="smtp.example.com" data-testid="input-smtp-host" />
                  {err("host")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-security">Security</Label>
                  <select
                    id="smtp-security"
                    value={form.security}
                    onChange={(e) => setSecurity(e.target.value as Security)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-testid="select-smtp-security"
                  >
                    <option value="starttls">STARTTLS</option>
                    <option value="tls">TLS (implicit)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-port">Port</Label>
                  <Input id="smtp-port" inputMode="numeric" value={form.port} onChange={(e) => set("port", e.target.value.replace(/\D/g, ""))} data-testid="input-smtp-port" />
                  {err("port")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-username">Username (optional)</Label>
                  <Input id="smtp-username" autoComplete="off" value={form.username} onChange={(e) => set("username", e.target.value)} data-testid="input-smtp-username" />
                  <p className="text-xs text-muted-foreground">Leave empty for anonymous relay.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-password">Password</Label>
                  <Input
                    id="smtp-password"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    disabled={form.clearPassword}
                    onChange={(e) => set("password", e.target.value)}
                    placeholder={hasPassword ? "Saved password is kept" : ""}
                    data-testid="input-smtp-password"
                  />
                  <p className="text-xs text-muted-foreground">
                    {hasPassword ? "A password is saved. Leave blank to keep it." : "No password saved."}
                  </p>
                  {hasPassword && (
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.clearPassword}
                        onChange={(e) => {
                          setJustSaved(false);
                          setTestResult(null);
                          setForm((f) => ({ ...f, clearPassword: e.target.checked, password: "" }));
                        }}
                        data-testid="checkbox-clear-password"
                      />
                      Remove saved password
                    </label>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-from-email">From address</Label>
                  <Input id="smtp-from-email" type="email" value={form.fromEmail} onChange={(e) => set("fromEmail", e.target.value)} placeholder="notifications@example.com" data-testid="input-smtp-from-email" />
                  {err("fromEmail")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-from-name">From name (optional)</Label>
                  <Input id="smtp-from-name" value={form.fromName} onChange={(e) => set("fromName", e.target.value)} data-testid="input-smtp-from-name" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="smtp-app-url">App URL</Label>
                  <Input id="smtp-app-url" value={form.appUrl} onChange={(e) => set("appUrl", e.target.value)} placeholder="https://kb.example.com" data-testid="input-smtp-app-url" />
                  <p className="text-xs text-muted-foreground">
                    The public, externally reachable address of this app. Links in emails are built from it.
                  </p>
                  {err("appUrl")}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={save} disabled={update.isPending || !dirty} data-testid="button-save-smtp">
                  {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save settings
                </Button>
                {justSaved && !dirty && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground" data-testid="status-smtp-saved">
                    <Check className="h-4 w-4 text-green-600" /> Saved
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Send a test email</CardTitle>
              <CardDescription>
                Sends a message to your own account address using the saved settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" onClick={sendTest} disabled={!canTest} data-testid="button-test-email">
                {test.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send test email
              </Button>
              {dirty && (
                <p className="text-xs text-muted-foreground" data-testid="text-test-blocked">
                  Save your changes before sending a test.
                </p>
              )}
              {!dirty && !saved.enabled && (
                <p className="text-xs text-muted-foreground">Enable and save email delivery to send a test.</p>
              )}
              {testResult && (
                <div
                  className={`flex items-start gap-2 rounded-md border p-3 text-sm ${testResult.ok ? "border-green-300 text-green-800 dark:text-green-300" : "border-destructive/40 text-destructive"}`}
                  data-testid={testResult.ok ? "status-test-success" : "status-test-error"}
                >
                  {testResult.ok ? <Check className="h-4 w-4 mt-0.5 shrink-0" /> : <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />}
                  <p>{testResult.message}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
