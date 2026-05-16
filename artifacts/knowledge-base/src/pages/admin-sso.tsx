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
import { Plus, Pencil, Trash2, ShieldCheck, Copy, Check, X } from "lucide-react";

interface SsoConfig {
  id: number;
  provider: "saml" | "oidc";
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

interface LexikonGroup {
  id: number;
  name: string;
}

type MappingRow = { samlValue: string; groupId: string };

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

function metadataUrl(id: number) {
  return `${window.location.origin}/api/auth/saml/${id}/metadata`;
}

function SsoFormFields({
  provider,
  values,
  onChange,
  isEdit,
  groups,
  groupMappingRows,
  onAddGroupRow,
  onUpdateGroupRow,
  onRemoveGroupRow,
}: {
  provider: "saml" | "oidc";
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
  isEdit: boolean;
  groups: LexikonGroup[];
  groupMappingRows: MappingRow[];
  onAddGroupRow: () => void;
  onUpdateGroupRow: (i: number, key: keyof MappingRow, val: string) => void;
  onRemoveGroupRow: (i: number) => void;
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

        {/* ── Group attribute mapping ─────────────────────────────────── */}
        <div className="border-t border-border pt-4 space-y-3">
          <div>
            <p className="text-sm font-medium">Group Attribute Mapping</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Map SAML attribute values to Lexikon groups. Memberships are synced on every login — added when asserted, removed when not.
            </p>
          </div>

          {field("groupAttributeName", "Group Attribute Name", "memberOf", {
            hint: 'The SAML attribute that carries group values, e.g. "memberOf" or "groups".',
          })}

          {groupMappingRows.length > 0 && (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground px-0.5">
                <span>SAML attribute value</span>
                <span>Lexikon group</span>
                <span />
              </div>
              {groupMappingRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <Input
                    value={row.samlValue}
                    onChange={(e) => onUpdateGroupRow(i, "samlValue", e.target.value)}
                    placeholder='e.g. CN=Editors,DC=corp'
                    className="text-xs h-8"
                  />
                  <Select
                    value={row.groupId}
                    onValueChange={(v) => onUpdateGroupRow(i, "groupId", v)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Pick group…" />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={String(g.id)}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemoveGroupRow(i)}
                    type="button"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button variant="outline" size="sm" onClick={onAddGroupRow} type="button" className="w-full text-xs">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add group mapping
          </Button>

          {groups.length === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              No groups exist yet. Create groups in Admin → Groups first.
            </p>
          )}
        </div>
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
  const [groupMappingRows, setGroupMappingRows] = useState<MappingRow[]>([]);

  const { data: configs = [], isLoading } = useQuery<SsoConfig[]>({
    queryKey: ["admin-sso"],
    queryFn: () => fetch("/api/admin/sso", { credentials: "include" }).then((r) => r.json()),
  });

  const { data: groups = [] } = useQuery<LexikonGroup[]>({
    queryKey: ["groups"],
    queryFn: () => fetch("/api/groups", { credentials: "include" }).then((r) => r.json()),
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

  function parseGroupMappingRows(config: Record<string, string>): MappingRow[] {
    if (!config.groupMappings) return [];
    try {
      const m = JSON.parse(config.groupMappings) as Record<string, string>;
      return Object.entries(m).map(([samlValue, groupId]) => ({ samlValue, groupId: String(groupId) }));
    } catch {
      return [];
    }
  }

  function serializeGroupMappings(rows: MappingRow[]): string | undefined {
    const valid = rows.filter((r) => r.samlValue.trim() && r.groupId);
    if (valid.length === 0) return undefined;
    const obj: Record<string, string> = {};
    for (const r of valid) obj[r.samlValue.trim()] = r.groupId;
    return JSON.stringify(obj);
  }

  const openCreate = () => {
    setEditRow(null);
    setProvider("oidc");
    setName("");
    setCfgValues({});
    setGroupMappingRows([]);
    setDialogOpen(true);
  };

  const openEdit = (row: SsoConfig) => {
    setEditRow(row);
    setProvider(row.provider);
    setName(row.name);
    setCfgValues({ ...row.config });
    setGroupMappingRows(parseGroupMappingRows(row.config));
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const finalCfg = { ...cfgValues };
    if (provider === "saml") {
      const serialized = serializeGroupMappings(groupMappingRows);
      if (serialized) {
        finalCfg.groupMappings = serialized;
      } else {
        delete finalCfg.groupMappings;
      }
    }

    if (editRow) {
      updateMutation.mutate({ id: editRow.id, body: { name, config: finalCfg } });
    } else {
      createMutation.mutate({ provider, name, enabled: false, config: finalCfg });
    }
  };

  const sharedFormProps = {
    values: cfgValues,
    onChange: (k: string, v: string) => setCfgValues((p) => ({ ...p, [k]: v })),
    groups,
    groupMappingRows,
    onAddGroupRow: () => setGroupMappingRows((r) => [...r, { samlValue: "", groupId: "" }]),
    onUpdateGroupRow: (i: number, key: keyof MappingRow, val: string) =>
      setGroupMappingRows((rows) => rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r)),
    onRemoveGroupRow: (i: number) =>
      setGroupMappingRows((rows) => rows.filter((_, idx) => idx !== i)),
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
          {configs.map((row) => {
            const hasGroupMapping =
              row.provider === "saml" &&
              row.config.groupMappings &&
              Object.keys(JSON.parse(row.config.groupMappings || "{}")).length > 0;

            return (
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
                      {hasGroupMapping && (
                        <Badge variant="outline" className="text-xs text-blue-700 border-blue-200 bg-blue-50 dark:bg-blue-950 dark:text-blue-300">
                          Group sync
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1.5 space-y-0.5">
                      <div className="flex items-center gap-1 font-mono">
                        <span className="shrink-0 text-muted-foreground/60 mr-0.5">ACS</span>
                        <span className="truncate">{callbackUrl(row.provider, row.id)}</span>
                        <CopyButton value={callbackUrl(row.provider, row.id)} />
                      </div>
                      {row.provider === "saml" && (
                        <div className="flex items-center gap-1 font-mono">
                          <span className="shrink-0 text-muted-foreground/60 mr-0.5">MD&nbsp;</span>
                          <span className="truncate">{metadataUrl(row.id)}</span>
                          <CopyButton value={metadataUrl(row.id)} />
                          <a
                            href={metadataUrl(row.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors ml-0.5"
                            title="Open metadata XML"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          </a>
                        </div>
                      )}
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
            );
          })}
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
          <p><strong>SAML 2.0:</strong> The easiest setup is to give your IdP the <strong>metadata URL</strong> (MD row on each provider card) — it bundles the ACS URL, Entity ID, and NameID format in one XML file that most IdPs can import directly. Alternatively, register the ACS URL manually as the <em>Assertion Consumer Service URL</em>. The SP Entity ID defaults to your app&apos;s origin unless you set a custom issuer.</p>
          <p><strong>SAML Group Mapping:</strong> Set the attribute name your IdP sends (e.g. <code>memberOf</code>) and add one row per value-to-group pair. Memberships for mapped groups are re-synced on every login.</p>
          <p><strong>OIDC / OAuth2:</strong> Add the callback URL as an allowed <em>Redirect URI</em> in your identity provider&apos;s application settings.</p>
          <p><strong>User provisioning:</strong> New SSO users are created automatically with the <em>user</em> role. Promote them in the Users admin page if needed.</p>
        </CardContent>
      </Card>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>{editRow ? "Edit SSO Provider" : "Add SSO Provider"}</DialogTitle>
            <DialogDescription>
              {editRow
                ? "Update the configuration. Secret fields showing ••••••••  will be kept unchanged unless you type a new value."
                : "Choose a protocol and fill in the identity provider details."}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 pr-1 space-y-5 py-1">
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
                <Tabs
                  value={provider}
                  onValueChange={(v) => {
                    setProvider(v as "saml" | "oidc");
                    setCfgValues({});
                    setGroupMappingRows([]);
                  }}
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="oidc" className="flex-1">OIDC / OAuth2</TabsTrigger>
                    <TabsTrigger value="saml" className="flex-1">SAML 2.0</TabsTrigger>
                  </TabsList>
                  <TabsContent value="oidc" className="mt-4">
                    <SsoFormFields provider="oidc" isEdit={false} {...sharedFormProps} />
                  </TabsContent>
                  <TabsContent value="saml" className="mt-4">
                    <SsoFormFields provider="saml" isEdit={false} {...sharedFormProps} />
                  </TabsContent>
                </Tabs>
              </div>
            )}

            {editRow && (
              <SsoFormFields provider={provider} isEdit {...sharedFormProps} />
            )}
          </div>

          <DialogFooter className="shrink-0 pt-2">
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
