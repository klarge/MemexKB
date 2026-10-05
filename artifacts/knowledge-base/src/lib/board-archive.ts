export async function setBoardArchived(id: number, archived: boolean): Promise<{
  id: number; projectId: number; archivedAt: string | null;
}> {
  const response = await fetch(`/api/boards/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Unable to ${archived ? "archive" : "restore"} board.`);
  return body;
}