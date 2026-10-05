import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function RenameBoard({ board, projectId }: {
  board: { id: number; name: string };
  projectId: number;
}) {
  const qc = useQueryClient();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(board.name);
  const [error, setError] = useState("");
  const rename = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/boards/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Unable to rename board. Please try again.");
      return body as { id: number; name: string };
    },
    onSuccess: async (updated) => {
      qc.setQueryData<Record<string, unknown>>(["board", board.id], (previous) =>
        previous ? { ...previous, name: updated.name } : previous,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["board", board.id] }),
        qc.invalidateQueries({ queryKey: ["project", projectId] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["projects-archived"] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
        qc.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
      setOpen(false);
      setError("");
    },
    onError: (failure: Error) => setError(failure.message),
  });
  return <>
    <Button type="button" variant="ghost" size="sm" aria-label={`Rename board ${board.name}`}
      onClick={() => { setName(board.name); setError(""); setOpen(true); }}>
      <Pencil className="mr-1.5 h-3.5 w-3.5" />Rename
    </Button>
    <Dialog open={open} onOpenChange={(next) => { if (!rename.isPending) setOpen(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename board</DialogTitle>
          <DialogDescription>Change this board's name without changing its cards or columns.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          if (!rename.isPending && name.trim()) rename.mutate();
          else if (!name.trim()) setError("Enter a board name.");
        }}>
          <div className="space-y-2">
            <Label htmlFor={inputId}>Board name</Label>
            <Input id={inputId} value={name} onChange={(event) => setName(event.target.value)}
              disabled={rename.isPending} autoFocus />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={rename.isPending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || rename.isPending}>
              {rename.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}