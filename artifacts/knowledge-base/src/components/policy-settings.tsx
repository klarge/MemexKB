import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCreatePolicySubject,
  useDeletePolicySubject,
  useListPolicySubjects,
  useUpdatePolicySubject,
  getListPolicySubjectsQueryKey,
  type PolicySubject,
} from "@workspace/api-client-react";
import { FolderTree, ListChecks, Loader2, Pencil, Plus, ScrollText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useSiteSettings, useInvalidateSiteSettings } from "@/lib/site-settings";
import { descendantIds, flattenSubjects } from "@/lib/policy-subjects";
import { KIND_LABEL, normalizeKind } from "@/lib/content-paths";

const selectClass = "flex h-9 w-full border border-input bg-transparent px-3 py-1 text-sm";

async function patchSettings(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Failed to save");
  return res.json();
}

function AreaSettingsCard({ kind }: { kind: "policy" | "procedure" }) {
  const isPolicy = kind === "policy";
  const { data: settings } = useSiteSettings();
  const invalidate = useInvalidateSiteSettings();
  const { toast } = useToast();
  const enabledKey = isPolicy ? "policiesEnabled" : "proceduresEnabled";
  const templateKey = isPolicy ? "policyTemplateId" : "procedureTemplateId";
  const enabled = Boolean(settings?.[enabledKey]);
  const templateId = settings?.[templateKey] ?? null;
  const Icon = isPolicy ? ScrollText : ListChecks;

  const { data: templates = [] } = useQuery<{ id: number; name: string; kind?: string }[]>({
    queryKey: ["templates", "admin-defaults"],
    queryFn: () => fetch("/api/templates", { credentials: "include" }).then((r) => r.json()),
  });
  const options = templates.filter((t) => normalizeKind(t.kind) === kind);

  const save = useMutation({
    mutationFn: patchSettings,
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card data-testid={`card-settings-${kind}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon className="h-4 w-4" />{isPolicy ? "Policies" : "Procedures"}</CardTitle>
        <CardDescription>
          {isPolicy
            ? "Shows a Policies item in the sidebar. Hiding it keeps all policies and existing links working."
            : "Shows a Procedures item in the sidebar. Hiding it keeps all procedures and existing links working."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch id={`${kind}-toggle`} checked={enabled} disabled={save.isPending} onCheckedChange={(v) => save.mutate({ [enabledKey]: v })} data-testid={`switch-${kind}-enabled`} />
          <label htmlFor={`${kind}-toggle`} className="text-sm cursor-pointer select-none">{enabled ? "Enabled" : "Disabled"}</label>
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-template`}>Default {KIND_LABEL[kind].toLowerCase()} template</Label>
          <select
            id={`${kind}-template`}
            className={selectClass}
            value={templateId ?? ""}
            disabled={save.isPending}
            onChange={(e) => save.mutate({ [templateKey]: e.target.value ? Number(e.target.value) : null })}
            data-testid={`select-${kind}-template`}
          >
            <option value="">No default (blank structured form)</option>
            {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Applies to new documents only. Saved documents and earlier runs are never changed.</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PolicyAreaSettings() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <AreaSettingsCard kind="policy" />
      <AreaSettingsCard kind="procedure" />
    </div>
  );
}

export function PolicySubjectManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: subjects = [], isLoading, isError, refetch } = useListPolicySubjects();
  const createSubject = useCreatePolicySubject();
  const updateSubject = useUpdatePolicySubject();
  const deleteSubject = useDeletePolicySubject();
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<number | null>(null);
  const [editing, setEditing] = useState<PolicySubject | null>(null);
  const [editName, setEditName] = useState("");
  const [editParent, setEditParent] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<PolicySubject | null>(null);
  const flat = flattenSubjects(subjects);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListPolicySubjectsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
  };
  const fail = (title: string) => (err: unknown) =>
    toast({ title, description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    createSubject.mutate({ data: { name, parentId: newParent } }, {
      onSuccess: () => { setNewName(""); refresh(); toast({ title: "Category added" }); },
      onError: fail("Could not add category"),
    });
  };
  const openEdit = (s: PolicySubject) => { setEditing(s); setEditName(s.name); setEditParent(s.parentId); };
  const saveEdit = () => {
    if (!editing || !editName.trim()) return;
    updateSubject.mutate({ id: editing.id, data: { name: editName.trim(), parentId: editParent } }, {
      onSuccess: () => { setEditing(null); refresh(); toast({ title: "Category saved" }); },
      onError: fail("Could not save category"),
    });
  };
  const confirmDelete = () => {
    if (!deleting) return;
    deleteSubject.mutate({ id: deleting.id }, {
      onSuccess: () => { setDeleting(null); refresh(); toast({ title: "Category deleted" }); },
      onError: (e) => { setDeleting(null); fail("Could not delete category")(e); },
    });
  };
  const blocked = editing ? descendantIds(subjects, editing.id) : new Set<number>();

  return (
    <Card data-testid="card-policy-subjects">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FolderTree className="h-4 w-4" />Policy Categories</CardTitle>
        <CardDescription>
          Every policy belongs to one category. Categories can be nested and moved. A category that still has policies or sub-categories cannot be deleted; move its contents first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-9 bg-muted animate-pulse" />)}</div>
        ) : isError ? (
          <div className="text-sm text-muted-foreground">Could not load categories. <Button variant="link" className="px-1" onClick={() => refetch()}>Try again</Button></div>
        ) : flat.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No categories yet. Add the first one below; there is no fixed taxonomy.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border" data-testid="list-policy-subjects">
            {flat.map((n) => (
              <li key={n.subject.id} className="flex items-center gap-2 px-3 py-2" style={{ paddingLeft: `${12 + n.depth * 20}px` }}>
                <span className="flex-1 text-sm truncate" data-testid={`text-subject-${n.subject.id}`}>{n.subject.name}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(n.subject)} aria-label={`Rename or move ${n.subject.name}`} data-testid={`button-edit-subject-${n.subject.id}`}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleting(n.subject)} aria-label={`Delete ${n.subject.name}`} data-testid={`button-delete-subject-${n.subject.id}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-md border border-dashed p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add a category</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="subject-name" className="text-xs">Name</Label>
              <Input id="subject-name" value={newName} maxLength={100} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} data-testid="input-subject-name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject-parent" className="text-xs">Inside</Label>
              <select id="subject-parent" className={selectClass} value={newParent ?? ""} onChange={(e) => setNewParent(e.target.value ? Number(e.target.value) : null)} data-testid="select-subject-parent">
                <option value="">Top level</option>
                {flat.map((n) => <option key={n.subject.id} value={n.subject.id}>{n.path.map((p) => p.name).join(" / ")}</option>)}
              </select>
            </div>
          </div>
          <Button size="sm" onClick={add} disabled={createSubject.isPending || !newName.trim()} data-testid="button-add-subject">
            {createSubject.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-2 h-3.5 w-3.5" />}
            Add Category
          </Button>
        </div>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit category</DialogTitle>
            <DialogDescription>Rename it or move it under another category.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-subject-name">Name</Label>
              <Input id="edit-subject-name" value={editName} maxLength={100} onChange={(e) => setEditName(e.target.value)} data-testid="input-edit-subject-name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-subject-parent">Inside</Label>
              <select id="edit-subject-parent" className={selectClass} value={editParent ?? ""} onChange={(e) => setEditParent(e.target.value ? Number(e.target.value) : null)} data-testid="select-edit-subject-parent">
                <option value="">Top level</option>
                {flat.filter((n) => !blocked.has(n.subject.id)).map((n) => (
                  <option key={n.subject.id} value={n.subject.id}>{n.path.map((p) => p.name).join(" / ")}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={saveEdit} disabled={updateSubject.isPending || !editName.trim()} data-testid="button-save-subject">
                {updateSubject.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This only works when the category has no policies and no sub-categories. Otherwise you will be asked to move them first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete} data-testid="button-confirm-delete-subject">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

