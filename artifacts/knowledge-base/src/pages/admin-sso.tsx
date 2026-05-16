import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, ShieldCheck, Copy, Check } from "lucide-react";

interface SsoConfig {
  id: number;
  provider: "saml" | "oidc";
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

const PLACEHOLDER = "••••••••";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="ml-1 text-muted-foreground hover:text-foreground transition-colors">
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function callbackUrl(provider: "saml" | "oidc", id: number) {
  return `${window.location.origin}/api/auth/${provider}/${id}/callback`;
}

function SsoFormFields({
  provider,
  values,
  onChange,
  isEdit,
}: {
  provider: "saml" | "oidc";
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
  isEdit: boolean;
}) {
  const field = (key: string, label: string, placeholder: string, opts?: { textarea?: boolean; hint?: string }) => (
    <div className="space-y-1.5" key={key}>
      <Label htmlFor={`sso-${key}`}>{label}</Label>
      {opts?.textarea ? (
        <Textarea
          id={`sso-${key}`}
          value={values[key] ?? ""}
          onChange={(e) => onChange(key, e.target.value)}
          placeholder={placeholder}
          className="font-mono text-xs"
          rows={4}
        />
      ) : (
        <Input
          id={`sso-${key}`}
          value={values[key] ?? ""}
          onChange={(e) => onChange(key, e.target.value)}
          placeholder={isEdit && !values[key] ? PLACEHOLDER : placeholder}
          type={key === "clientSecret" ? "password" : "text"}
        />
      )}
      {opts?.hint && <p className="text-xs text-muted-foreground">{opts.hint}</p>}
    </div>
  );

  if (provider === "saml") {
    return (
      <div className="space-y-4">
        {field("entryPoint", "IdP SSO URL *", "https://idp.example.com/sso/saml")}
        {field("issuer", "SP Entity ID / Issuer", window.location.origin, {
          hint: "Defaults to your app's origin if left blank.",
        })}
        {field("idpCert", "IdP Certificate (PEM) *", "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----", {
          textarea: true,
          hint: "Paste the X.509 certificate from your identity provider.",
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {field("issuerUrl", "Issuer / Discovery URL *", "https://accounts.google.com", {
        hint: "The OIDC discovery URL. Append /.well-known/openid-configuration to test.",
      })}
      {field("clientId", "Client ID *", "your-client-id")}
      {field("clientSecret", "Client Secret *", isEdit ? PLACEHOLDER : "your-client-secret")}
      {field("scope", "Scopes", "openid email profile", {
        hint: "Space-separated OIDC scopes. Default: openid email profile",
      })}
    </div>
  );
}

export default function AdminSso() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editRow, setEditRow] = useState<SsoConfig | null>(null);
  const [provider, setProvider] = useState<"saml" | "oidc">("oidc");
  const [name, setName] = useState("");
  const [cfgValues, setCfgValues] = useState<Record<string, string>>({});

  const { data: configs = [], isLoading } = useQuery<SsoConfig[]>({
    queryKey: ["admin-sso"],
    queryFn: () => fetch("/api/admin/sso", { credentials: "include" }).then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      fetch("/api/admin/sso", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sso"] });
      setDialogOpen(false);
      toast({ title: "SSO provider added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      fetch(`/api/admin/sso/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sso"] });
      setDialogOpen(false);
      toast({ title: "SSO provider updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/admin/sso/${id}`, { method: "DELETE", credentials: "include" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sso"] });
      toast({ title: "SSO provider deleted" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      fetch(`/api/admin/sso/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-sso"] }),
  });

  const openCreate = () => {
    setEditRow(null);
    setProvider("oidc");
    setName("");
    setCfgValues({});
    setDialogOpen(true);
  };

  const openEdit = (row: SsoConfig) => {
    setEditRow(row);
    setProvider(row.provider);
    setName(row.name);
    setCfgValues({ ...row.config });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (editRow) {
      updateMutation.mutate({ id: editRow.id, body: { name, config: cfgValues } });
    } else {
      createMutation.mutate({ provider, name, enabled: false, config: cfgValues });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" /> SSO / Identity Providers
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure SAML 2.0 or OIDC providers. Local login always remains available.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Add Provider
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : configs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No SSO providers configured</p>
            <p className="text-sm mt-1">Add a SAML or OIDC provider to enable single sign-on.</p>
            <Button variant="outline" className="mt-4" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Add Provider
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {configs.map((row) => (
            <Card key={row.id}>
              <CardContent className="py-4 px-5 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{row.name}</span>
                    <Badge variant="outline" className="text-xs uppercase tracking-wide">
                      {row.provider === "saml" ? "SAML 2.0" : "OIDC / OAuth2"}
                    </Badge>
                    {row.enabled ? (
                      <Badge className="text-xs bg-green-100 text-green-800 border-green-200">Enabled</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">Disabled</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1 font-mono">
                    <span className="truncate">{callbackUrl(row.provider, row.id)}</span>
                    <CopyButton value={callbackUrl(row.provider, row.id)} />
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(enabled) => toggleMutation.mutate({ id: row.id, enabled })}
                    title={row.enabled ? "Disable" : "Enable"}
                  />
                  <Button variant="ghost" size="icon" onClick={() => openEdit(row)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(row.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* How-to reference */}
      <Card className="bg-muted/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Setup Reference</CardTitle>
          <CardDescription className="text-xs">
            Register the callback URL shown above with your identity provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1.5">
          <p><strong>SAML 2.0:</strong> Add the callback URL as the <em>Assertion Consumer Service (ACS) URL</em>. The SP Entity ID defaults to your app&apos;s origin unless you set a custom issuer.</p>
          <p><strong>OIDC / OAuth2:</strong> Add the callback URL as an allowed <em>Redirect URI</em> in your identity provider&apos;s application settings.</p>
          <p><strong>User provisioning:</strong> New SSO users are created automatically with the <em>user</em> role. Promote them in the Users admin page if needed.</p>
        </CardContent>
      </Card>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editRow ? "Edit SSO Provider" : "Add SSO Provider"}</DialogTitle>
            <DialogDescription>
              {editRow
                ? "Update the configuration. Secret fields showing ••••••••  will be kept unchanged unless you type a new value."
                : "Choose a protocol and fill in the identity provider details."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1">
            <div className="space-y-1.5">
              <Label>Display Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Okta, Google Workspace, Azure AD"
              />
            </div>

            {!editRow && (
              <div className="space-y-1.5">
                <Label>Protocol</Label>
                <Tabs value={provider} onValueChange={(v) => { setProvider(v as "saml" | "oidc"); setCfgValues({}); }}>
                  <TabsList className="w-full">
                    <TabsTrigger value="oidc" className="flex-1">OIDC / OAuth2</TabsTrigger>
                    <TabsTrigger value="saml" className="flex-1">SAML 2.0</TabsTrigger>
                  </TabsList>
                  <TabsContent value="oidc" className="mt-4">
                    <SsoFormFields provider="oidc" values={cfgValues} onChange={(k, v) => setCfgValues((p) => ({ ...p, [k]: v }))} isEdit={false} />
                  </TabsContent>
                  <TabsContent value="saml" className="mt-4">
                    <SsoFormFields provider="saml" values={cfgValues} onChange={(k, v) => setCfgValues((p) => ({ ...p, [k]: v }))} isEdit={false} />
                  </TabsContent>
                </Tabs>
              </div>
            )}

            {editRow && (
              <SsoFormFields
                provider={provider}
                values={cfgValues}
                onChange={(k, v) => setCfgValues((p) => ({ ...p, [k]: v }))}
                isEdit
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
              {isPending ? "Saving…" : editRow ? "Save Changes" : "Add Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SSO provider?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the configuration. Users who signed in via this provider will still exist but will need a password reset to log back in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId !== null) { deleteMutation.mutate(deleteId); setDeleteId(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
