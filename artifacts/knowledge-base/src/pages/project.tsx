import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  Plus, Trash2, LayoutGrid, ArrowLeft, Loader2, X, Users, Shield, FolderKanban,
} from "lucide-react";
import { format } from "date-fns";

type Board = { id: number; name: string; position: number; createdAt: string };
type Group = { id: number; name: string };
type ProjectDetail = {
  id: number;
  name: string;
  description: string;
  createdById: number | null;
  boards: Board[];
  groups: Group[];
  isOwner: boolean;
};
type GroupItem = { id: number; name: string; description: string };

export default function ProjectPage({ params }: { params: { projectId: string } }) {
  const projectId = Number(params.projectId);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [newBoardName, setNewBoardName] = useState("");
  const [showBoardForm, setShowBoardForm] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | "">("");

  const { data: project, isLoading } = useQuery<ProjectDetail>({
    queryKey: ["project", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}`).then((r) => r.json()),
  });

  const { data: allGroups = [] } = useQuery<GroupItem[]>({
    queryKey: ["all-groups"],
    queryFn: () => fetch("/api/groups").then((r) => r.json()),
    enabled: project?.isOwner === true,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["project", projectId] });

  const createBoard = useMutation({
    mutationFn: () =>
      fetch(`/api/projects/${projectId}/boards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBoardName }),
      }),
    onSuccess: () => { invalidate(); setNewBoardName(""); setShowBoardForm(false); },
  });

  const deleteProject = useMutation({
    mutationFn: () => fetch(`/api/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); setLocation("/projects"); },
  });

  const addGroup = useMutation({
    mutationFn: (groupId: number) =>
      fetch(`/api/projects/${projectId}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      }),
    onSuccess: () => { invalidate(); setShowGroupForm(false); setSelectedGroupId(""); },
  });

  const removeGroup = useMutation({
    mutationFn: (groupId: number) =>
      fetch(`/api/projects/${projectId}/groups/${groupId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const deleteBoard = useMutation({
    mutationFn: (boardId: number) => fetch(`/api/boards/${boardId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return <div className="text-center py-20 text-muted-foreground">Project not found.</div>;
  }

  const sharedGroupIds = new Set(project.groups.map((g) => g.id));
  const availableGroups = allGroups.filter((g) => !sharedGroupIds.has(g.id));

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div>
        <Link href="/projects">
          <button type="button" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3">
            <ArrowLeft className="h-3.5 w-3.5" /> All Projects
          </button>
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FolderKanban className="h-6 w-6" />
              {project.name}
            </h1>
            {project.description && (
              <p className="text-muted-foreground text-sm mt-1">{project.description}</p>
            )}
          </div>
          {project.isOwner && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirm("Delete this project and all its boards? This cannot be undone.")) {
                  deleteProject.mutate();
                }
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete Project
            </Button>
          )}
        </div>
      </div>

      {/* Boards */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
            Boards
          </h2>
          {!showBoardForm && (
            <Button size="sm" onClick={() => setShowBoardForm(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New Board
            </Button>
          )}
        </div>

        {showBoardForm && (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              placeholder="Board name…"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newBoardName.trim()) createBoard.mutate();
                if (e.key === "Escape") { setShowBoardForm(false); setNewBoardName(""); }
              }}
              className="max-w-xs"
            />
            <Button onClick={() => createBoard.mutate()} disabled={!newBoardName.trim() || createBoard.isPending}>
              {createBoard.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
            <Button variant="ghost" onClick={() => { setShowBoardForm(false); setNewBoardName(""); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {project.boards.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 py-12 text-center text-muted-foreground">
            <LayoutGrid className="mx-auto h-8 w-8 opacity-20 mb-2" />
            <p className="text-sm">No boards yet. Create one to start organizing work.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {project.boards.map((board) => (
              <div key={board.id} className="group relative rounded-xl border bg-card p-4 hover:shadow-md transition-all hover:border-primary/30">
                <Link href={`/projects/${projectId}/boards/${board.id}`}>
                  <div className="cursor-pointer">
                    <h3 className="font-semibold group-hover:text-primary transition-colors">{board.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Created {format(new Date(board.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete board "${board.name}"?`)) deleteBoard.mutate(board.id);
                  }}
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Shared With (owner only) */}
      {project.isOwner && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Shared With
            </h2>
            {!showGroupForm && availableGroups.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setShowGroupForm(true)}>
                <Shield className="mr-1.5 h-3.5 w-3.5" /> Share with Group
              </Button>
            )}
          </div>

          {showGroupForm && (
            <div className="flex items-center gap-2">
              <select
                className="border rounded-md px-3 py-2 text-sm bg-background"
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">Select a group…</option>
                {availableGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => { if (selectedGroupId !== "") addGroup.mutate(Number(selectedGroupId)); }}
                disabled={selectedGroupId === "" || addGroup.isPending}
              >
                Share
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowGroupForm(false); setSelectedGroupId(""); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {project.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Only you have access. Share with a group to collaborate.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {project.groups.map((g) => (
                <div key={g.id} className="group flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-sm">
                  <Shield className="h-3 w-3 text-muted-foreground" />
                  <span>{g.name}</span>
                  <button
                    type="button"
                    onClick={() => removeGroup.mutate(g.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all ml-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
