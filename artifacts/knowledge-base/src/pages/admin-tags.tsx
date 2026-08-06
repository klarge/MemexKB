import { useState } from "react";
import {
  useListTags,
  getListTagsQueryKey,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  type Tag,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Edit, Trash2, Tag as TagIcon, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#f59e0b", "#22c55e", "#10b981", "#14b8a6", "#3b82f6",
  "#64748b", "#1e293b",
];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className="w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all"
          style={{
            backgroundColor: c,
            borderColor: value === c ? "white" : c,
            outline: value === c ? `2px solid ${c}` : "none",
            outlineOffset: "2px",
          }}
          onClick={() => onChange(c)}
        >
          {value === c && <Check className="h-3 w-3 text-white" />}
        </button>
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-7 h-7 rounded-full border border-border cursor-pointer p-0"
        title="Custom color"
      />
    </div>
  );
}

function TagForm({
  initial,
  onSave,
  onCancel,
  loading,
}: {
  initial?: { name: string; color: string };
  onSave: (name: string, color: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? "#6366f1");

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="tag-name">Tag name</Label>
        <Input
          id="tag-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Release Notes"
          className="mt-1"
          autoFocus
        />
      </div>
      <div>
        <Label className="mb-2 block">Color</Label>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm text-muted-foreground">Preview:</span>
        <Badge style={{ backgroundColor: color, color: "#fff", borderColor: color }}>
          {name || "Tag name"}
        </Badge>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={() => onSave(name, color)} disabled={loading || !name.trim()}>
          {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save tag
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function AdminTags() {
  const { data: tags = [], isLoading } = useListTags({
    query: { queryKey: getListTagsQueryKey() },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createMutation = useCreateTag();
  const updateMutation = useUpdateTag();
  const deleteMutation = useDeleteTag();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTag, setEditTag] = useState<Tag | null>(null);

  const handleCreate = (name: string, color: string) => {
    createMutation.mutate(
      { data: { name, color } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTagsQueryKey() });
          setCreateOpen(false);
          toast({ title: "Tag created" });
        },
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleUpdate = (name: string, color: string) => {
    if (!editTag) return;
    updateMutation.mutate(
      { id: editTag.id, data: { name, color } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTagsQueryKey() });
          setEditTag(null);
          toast({ title: "Tag updated" });
        },
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTagsQueryKey() });
          toast({ title: "Tag deleted" });
        },
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-2">
            <TagIcon className="h-7 w-7" />
            Tags
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage tags for articles. Only admins can create or delete tags. Editors and users can apply
            existing tags when editing articles.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Tag
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : tags.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <TagIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No tags yet. Create the first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tags.map((tag) => (
            <Card key={tag.id}>
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="h-4 w-4 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{tag.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {tag.articleCount} {tag.articleCount === 1 ? "article" : "articles"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setEditTag(tag)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete tag "{tag.name}"?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove the tag from all {tag.articleCount}{" "}
                          {tag.articleCount === 1 ? "article" : "articles"} it is applied to. This
                          cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive hover:bg-destructive/90"
                          onClick={() => handleDelete(tag.id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Tag</DialogTitle>
          </DialogHeader>
          <TagForm
            onSave={handleCreate}
            onCancel={() => setCreateOpen(false)}
            loading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTag} onOpenChange={(open) => { if (!open) setEditTag(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Tag</DialogTitle>
          </DialogHeader>
          {editTag && (
            <TagForm
              initial={{ name: editTag.name, color: editTag.color }}
              onSave={handleUpdate}
              onCancel={() => setEditTag(null)}
              loading={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
