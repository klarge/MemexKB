import { useMutation } from "@tanstack/react-query";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type TaskDeletion =
  | { kind: "list"; id: number; name: string }
  | { kind: "task"; id: number; name: string }
  | { kind: "completed"; ids: number[]; name: string };

export function TaskDeleteDialog({ target, onClose, onDeleted }: {
  target: TaskDeletion | null;
  onClose: () => void;
  onDeleted: () => Promise<unknown>;
}) {
  const deletion = useMutation({
    mutationFn: async (selection: TaskDeletion) => {
      const paths = selection.kind === "completed"
        ? selection.ids.map((id) => `/api/tasks/${id}`)
        : [selection.kind === "list" ? `/api/tasks/lists/${selection.id}` : `/api/tasks/${selection.id}`];
      for (const path of paths) {
        const response = await fetch(path, { method: "DELETE" });
        if (!response.ok) throw new Error("Could not delete. Please try again.");
      }
    },
    onSuccess: async () => { await onDeleted(); close(); },
    // Refresh after a failed bulk deletion too, in case some tasks were removed.
    onError: () => { void onDeleted(); },
  });
  function close() {
    deletion.reset();
    onClose();
  }
  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => {
      if (!open && !deletion.isPending) close();
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {target?.kind === "list" ? "Delete task list?" :
              target?.kind === "completed" ? "Delete completed tasks?" : "Delete task?"}
          </AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {target?.kind === "list"
              ? `Delete "${target.name}" and all its tasks, including completed tasks? This cannot be undone.`
              : target?.kind === "completed"
                ? `Delete ${target.ids.length} completed ${target.ids.length === 1 ? "task" : "tasks"} from "${target.name}"? This cannot be undone.`
                : `Delete "${target?.name ?? ""}"? This cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deletion.isError && <p role="alert" className="text-sm text-destructive">{deletion.error.message}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletion.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={deletion.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(event) => {
              event.preventDefault();
              if (target && !deletion.isPending) deletion.mutate(target);
            }}>
            {deletion.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
