import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function EditTask({ task }: { task: { id: number; title: string } }) {
  const qc = useQueryClient();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [error, setError] = useState("");
  const edit = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Unable to save task. Please try again.");
      return body;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["task-lists"] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      setOpen(false);
      setError("");
    },
    onError: (failure: Error) => setError(failure.message),
  });
  return <>
    <Button type="button" variant="ghost" size="sm"
      className="shrink-0 px-2" aria-label={`Edit task ${task.title}`}
      onClick={() => { setTitle(task.title); setError(""); setOpen(true); }}>
      <Pencil className="mr-1 h-3.5 w-3.5" />Edit
    </Button>
    <Dialog open={open} onOpenChange={(next) => { if (!edit.isPending) setOpen(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Update the task text without changing its list or completion status.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          if (!edit.isPending && title.trim()) edit.mutate();
          else if (!title.trim()) setError("Enter a task title.");
        }}>
          <div className="space-y-2">
            <Label htmlFor={inputId}>Task title</Label>
            <Input id={inputId} value={title} onChange={(event) => setTitle(event.target.value)}
              autoFocus disabled={edit.isPending} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={edit.isPending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!title.trim() || edit.isPending}>
              {edit.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}