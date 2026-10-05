import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectManagerPerson as Person } from "@workspace/api-client-react";

export function ProjectManager({ projectId, manager, canManage }: {
  projectId: number;
  manager: Person | null;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const candidates = useQuery<Person[]>({
    queryKey: ["project-manager-candidates", projectId],
    enabled: canManage,
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/manager-candidates`);
      if (!response.ok) throw new Error("Unable to load manager choices.");
      return response.json();
    },
  });
  const assign = useMutation({
    mutationFn: async (managerId: number) => {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Unable to assign Project Manager.");
      }
    },
    onSuccess: () => { setError(""); qc.invalidateQueries(); },
    onError: (failure: Error) => setError(failure.message),
  });
  return (
    <div className="mt-4 space-y-1">
      <label className="block text-sm font-medium" htmlFor={`project-manager-${projectId}`}>Project Manager</label>
      {canManage ? (
        <>
          <select
            id={`project-manager-${projectId}`}
            aria-describedby={`project-manager-help-${projectId}`}
            className="h-9 max-w-full min-w-56 rounded-md border border-input bg-background px-3 text-sm"
            value={manager?.id ?? ""}
            disabled={candidates.isLoading || candidates.isError || assign.isPending}
            onChange={(event) => assign.mutate(Number(event.target.value))}
          >
            {!manager && <option value="" disabled>Choose a manager</option>}
            {manager && !candidates.data?.some((person) => person.id === manager.id) && <option value={manager.id}>{manager.name}</option>}
            {candidates.data?.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
          <p id={`project-manager-help-${projectId}`} className="text-xs text-muted-foreground">The manager can manage settings, sharing and deletion. The creator and administrators retain control.</p>
          {assign.isPending && <p role="status" className="text-xs text-muted-foreground">Saving manager…</p>}
          {(error || candidates.isError) && <p role="alert" className="text-sm text-destructive">{error || "Unable to load manager choices."}</p>}
        </>
      ) : <p className="text-sm text-muted-foreground">{manager?.name ?? "Unassigned"}</p>}
    </div>
  );
}