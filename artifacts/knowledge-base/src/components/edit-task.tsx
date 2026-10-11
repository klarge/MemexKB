import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Task } from "@workspace/api-client-react";

export function EditTask({ task }: { task: Pick<Task, "id" | "title" | "dueDate"> }) {
  const qc = useQueryClient();
  const inputId = useId();
  const dueDateId = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate?.slice(0, 10) ?? "");
  const [error, setError] = useState("");
  const edit = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), dueDate: dueDate || null }),
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
    <Button type="button" variant="ghost" size="icon"
      className="h-8 w-8 shrink-0" title="Edit task" aria-label={`Edit task ${task.title}`}
      onClick={() => { setTitle(task.title); setDueDate(task.dueDate?.slice(0, 10) ?? ""); setError(""); setOpen(true); }}>
      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
    <Dialog open={open} onOpenChange={(next) => { if (!edit.isPending) setOpen(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Update the task text and due date without changing its list or completion status.</DialogDescription>
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
          <div className="space-y-2">
            <Label htmlFor={dueDateId}>Due date</Label>
            <div className="flex items-center gap-2">
              <Input id={dueDateId} type="date" value={dueDate}
                onChange={(event) => setDueDate(event.target.value)} disabled={edit.isPending}
                data-testid="input-task-due-date" />
              {dueDate && (
                <Button type="button" variant="outline" size="sm" disabled={edit.isPending}
                  onClick={() => setDueDate("")} data-testid="button-clear-task-due-date">Clear</Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Due-soon emails use your Email Notifications preferences and the same reminder timing as project cards.
            </p>
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