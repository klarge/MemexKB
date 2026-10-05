import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Edit, Trash2, LayoutTemplate, Search } from "lucide-react";
import { useVisibleItems } from "@/hooks/use-visible-items";
import { LoadMore } from "@/components/load-more";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { KIND_LABEL, normalizeKind } from "@/lib/content-paths";
import { useSiteSettings } from "@/lib/site-settings";

type TemplateSummary = {
  id: number;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  kind?: string;
};

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export default function Templates() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "knowledge" | "policy" | "procedure">("all");
  const { data: settings } = useSiteSettings();

  const canEdit = user?.role === "admin";

  const { data: templates = [], isLoading } = useQuery<TemplateSummary[]>({
    queryKey: ["templates", user?.id],
    queryFn: () => fetch("/api/templates", { credentials: "include" }).then((r) => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/templates/${id}`, { method: "DELETE", credentials: "include" }).then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? "Failed to delete");
        }
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (e: Error) => toast({ title: "Failed to delete template", description: e.message, variant: "destructive" }),
  });

  const filtered = templates.filter((t) =>
    (kindFilter === "all" || normalizeKind(t.kind) === kindFilter) && (
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    stripHtml(t.content).toLowerCase().includes(search.toLowerCase()))
  );

  const templateWindow = useVisibleItems(filtered, JSON.stringify([user?.id, kindFilter, search.toLowerCase()]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <LayoutTemplate className="h-6 w-6" />
            Templates
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Reusable starting points for Knowledge articles, Policies, and Procedures. Changes apply to future documents only.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setLocation("/templates/new")}>
            <Plus className="mr-2 h-4 w-4" /> New Template
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search templates…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex gap-2 flex-wrap" role="group" aria-label="Template type">
        {(["all", "knowledge", "policy", "procedure"] as const).map((k) => (
          <Button key={k} size="sm" variant={kindFilter === k ? "default" : "outline"} onClick={() => setKindFilter(k)} data-testid={`filter-template-${k}`}>
            {k === "all" ? "All" : KIND_LABEL[k]}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {search ? (
            <p>No templates match your search.</p>
          ) : (
            <div className="space-y-2">
              <LayoutTemplate className="mx-auto h-10 w-10 opacity-20" />
              <p className="font-medium">No templates yet</p>
              {canEdit && (
                <p className="text-sm">
                  Create your first template to reuse content across articles.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templateWindow.items.map((t) => (
            <Card key={t.id} className="flex flex-col hover:shadow-sm transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base font-semibold leading-snug line-clamp-2">
                    {t.name}
                  </CardTitle>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="secondary" className="text-xs font-normal" data-testid={`badge-template-kind-${t.id}`}>{KIND_LABEL[normalizeKind(t.kind)]}</Badge>
                    {((normalizeKind(t.kind) === "policy" && settings?.policyTemplateId === t.id) ||
                      (normalizeKind(t.kind) === "procedure" && settings?.procedureTemplateId === t.id)) && (
                      <Badge variant="outline" className="text-xs font-normal">Default</Badge>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setLocation(`/templates/${t.id}/edit`)}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete template?</AlertDialogTitle>
                            <AlertDialogDescription>
                              "{t.name}" will be permanently removed. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => deleteMutation.mutate(t.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-3">
                <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
                  {stripHtml(t.content) || <span className="italic">No content</span>}
                </p>
                <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border">
                  <span>{t.createdByName ?? "Unknown"}</span>
                  <Badge variant="outline" className="text-xs font-normal">
                    {format(new Date(t.updatedAt), "MMM d, yyyy")}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
          <LoadMore hasMore={templateWindow.hasMore} onClick={templateWindow.loadMore} />
        </div>
      )}
    </div>
  );
}
