import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useChangePassword,
  useListApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
  getListApiTokensQueryKey,
  type ApiTokenCreated,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, KeyRound, Plus, Trash2, Copy, Check, TriangleAlert } from "lucide-react";

// ── Password change ───────────────────────────────────────────────────────────

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
  confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type PasswordFormValues = z.infer<typeof passwordSchema>;

function ChangePasswordCard() {
  const { toast } = useToast();
  const changePassword = useChangePassword();

  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const onSubmit = (data: PasswordFormValues) => {
    changePassword.mutate(
      { data: { currentPassword: data.currentPassword, newPassword: data.newPassword } },
      {
        onSuccess: () => { toast({ title: "Password updated successfully" }); form.reset(); },
        onError: (error) => {
          toast({
            title: "Update failed",
            description: error.message || "Please check your current password and try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Change Password
        </CardTitle>
        <CardDescription>Update your password to keep your account secure.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="currentPassword" render={({ field }) => (
              <FormItem>
                <FormLabel>Current Password</FormLabel>
                <FormControl><Input type="password" data-testid="input-current-password" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="newPassword" render={({ field }) => (
              <FormItem>
                <FormLabel>New Password</FormLabel>
                <FormControl><Input type="password" data-testid="input-new-password" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="confirmPassword" render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm New Password</FormLabel>
                <FormControl><Input type="password" data-testid="input-confirm-password" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" disabled={changePassword.isPending} data-testid="button-change-password">
              {changePassword.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Password
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

// ── New-token reveal banner ───────────────────────────────────────────────────

function NewTokenBanner({ created, onDismiss }: { created: ApiTokenCreated; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(created.token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4 space-y-3">
      <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
        <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
        <p className="text-sm font-medium">
          Copy this token now — it won't be shown again.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded bg-background border border-border px-3 py-2 text-xs font-mono break-all select-all">
          {created.token}
        </code>
        <Button size="sm" variant="outline" onClick={handleCopy} className="shrink-0">
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Use this token in the <code className="text-xs">Authorization: Bearer &lt;token&gt;</code> header.
        {" "}Access: {created.accessMode === "read_only" ? "Read-only" : "Full access"}.
      </p>
      <Button size="sm" variant="ghost" onClick={onDismiss} className="text-xs h-7">
        I've saved it — dismiss
      </Button>
    </div>
  );
}

// ── API Keys card ─────────────────────────────────────────────────────────────

const newKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  accessMode: z.enum(["full", "read_only"]),
  expiresAt: z.string().optional(),
});
type NewKeyFormValues = z.infer<typeof newKeySchema>;

function ApiKeysCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [newToken, setNewToken] = useState<ApiTokenCreated | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const { data: tokens = [], isLoading } = useListApiTokens();
  const createToken = useCreateApiToken();
  const revokeToken = useRevokeApiToken();

  const form = useForm<NewKeyFormValues>({
    resolver: zodResolver(newKeySchema),
    defaultValues: { name: "", accessMode: "full", expiresAt: "" },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListApiTokensQueryKey() });

  const onSubmit = (data: NewKeyFormValues) => {
    createToken.mutate(
        { data: { name: data.name.trim(), accessMode: data.accessMode, expiresAt: data.expiresAt || undefined } },
      {
        onSuccess: (created) => {
          setNewToken(created);
          setShowForm(false);
          form.reset();
          void invalidate();
        },
        onError: (err) => {
          toast({ title: "Failed to create key", description: err.message, variant: "destructive" });
        },
      },
    );
  };

  const handleRevoke = (id: number, name: string) => {
    if (!confirm(`Revoke key "${name}"? Any clients using it will lose access immediately.`)) return;
    setRevokingId(id);
    revokeToken.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Key revoked" });
          void invalidate();
        },
        onError: (err) => {
          toast({ title: "Failed to revoke key", description: err.message, variant: "destructive" });
        },
        onSettled: () => setRevokingId(null),
      },
    );
  };

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  const isExpired = (expiresAt: string | null | undefined) =>
    expiresAt ? new Date(expiresAt) < new Date() : false;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            API Keys
          </CardTitle>
          <CardDescription className="mt-1">
            Personal API keys let you access this knowledge base programmatically.
            Keys inherit your permissions, with an optional read-only restriction.
          </CardDescription>
        </div>
        {!showForm && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => { setShowForm(true); setNewToken(null); }}
          >
            <Plus className="h-4 w-4 mr-1" />
            New key
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* New-token reveal */}
        {newToken && (
          <NewTokenBanner created={newToken} onDismiss={() => setNewToken(null)} />
        )}

        {/* Create form */}
        {showForm && (
          <div className="rounded-md border border-border p-4 space-y-3 bg-muted/30">
            <p className="text-sm font-medium">New API key</p>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. CI pipeline, personal script"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="accessMode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Access</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        data-testid="select-api-key-access"
                      >
                        <option value="full">Full access</option>
                        <option value="read_only">Read-only</option>
                      </select>
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Read-only keys can retrieve content you can access but cannot change anything.
                    </p>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="expiresAt" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expires (optional)</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={createToken.isPending}>
                    {createToken.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Generate
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => { setShowForm(false); form.reset(); }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        )}

        {/* Token list */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No API keys yet. Generate one to get started.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
            {tokens.map((token) => {
              const expired = isExpired(token.expiresAt);
              return (
                <div key={token.id} className="flex items-center gap-3 px-3 py-2.5 bg-background text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{token.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-medium text-foreground">
                        {token.accessMode === "read_only" ? "Read-only" : "Full access"}
                      </span>
                      {" · "}
                      Created {formatDate(token.createdAt)}
                      {" · "}
                      {token.lastUsedAt ? `Last used ${formatDate(token.lastUsedAt)}` : "Never used"}
                      {token.expiresAt && (
                        <span className={expired ? "text-destructive font-medium" : ""}>
                          {" · "}{expired ? "Expired" : "Expires"} {formatDate(token.expiresAt)}
                        </span>
                      )}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={revokingId === token.id}
                    onClick={() => handleRevoke(token.id, token.name)}
                    title="Revoke key"
                  >
                    {revokingId === token.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Settings() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-primary">Settings</h1>
      <ChangePasswordCard />
      <ApiKeysCard />
    </div>
  );
}
