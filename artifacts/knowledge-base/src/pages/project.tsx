import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  Plus, Trash2, LayoutGrid, ArrowLeft, Loader2, X, Users, Shield, FolderKanban,
  Archive, ArchiveRestore, ChevronDown, ChevronRight, FileText,
} from "lucide-react";
import { format } from "date-fns";

type Board = { id: number; name: string; position: number; archivedAt: string | null; createdAt: string };
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
type ProjectDocument = {
  id: number;
  slug: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  updatedByName: string | null;
  canEdit: boolean;
};

export default function ProjectPage({ params }: { params: { projectId: string } }) {
  const projectId = Number(params.projectId);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [newBoardName, setNewBoardName] = useState("");
  const [showBoardForm, setShowBoardForm] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | "">("");
  const [showArchivedBoards, setShowArchivedBoards] = useState(false);

  const { data: project, isLoading } = useQuery<ProjectDetail>({
    queryKey: ["project", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}`).then((r) => r.json()),
  });

  const { data: allGroups = [] } = useQuery<GroupItem[]>({
    queryKey: ["all-groups"],
    queryFn: () => fetch("/api/groups").then((r) => r.json()),
    enabled: project?.isOwner === true,
  });
  const { data: documentsData, isLoading: isLoadingDocuments, isError: isDocumentsError } = useQuery<{ documents: ProjectDocument[] }>({
    queryKey: ["project-documents", projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/documents`);
      if (!response.ok) throw new Error("Unable to load project documents.");
      return response.json();
    },
    enabled: !!project,
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

  const archiveBoard = useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      fetch(`/api/boards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      }),
    onSuccess: invalidate,
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
  const deleteDocument = useMutation({
    mutationFn: (slug: string) => fetch(`/api/projects/${projectId}/documents/${slug}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-documents", projectId] }),
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
  const activeBoards = project.boards.filter((b) => !b.archivedAt);
  const archivedBoards = project.boards.filter((b) => !!b.archivedAt);
  const documents = documentsData?.documents ?? [];
  const canEditDocuments = project.isOwner || user?.role === "admin" || user?.role === "editor";

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
                if (confirm("Delete this project and all its boards and documents? This cannot be undone.")) {
                  deleteProject.mutate();
                }
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete Project
            </Button>
          )}
        </div>
      </div>

      {/* Documents */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Documents
          </h2>
          {canEditDocuments && (
            <Link href={`/projects/${projectId}/documents/new/edit`}>
              <Button size="sm">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New Document
              </Button>
            </Link>
          )}
        </div>

        {isLoadingDocuments ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isDocumentsError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 py-8 text-center">
            <p className="text-sm font-medium text-destructive">Unable to load project documents.</p>
            <p className="mt-1 text-xs text-muted-foreground">Refresh the page to try again.</p>
          </div>
        ) : documents.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 py-10 text-center text-muted-foreground">
            <FileText className="mx-auto h-8 w-8 opacity-20 mb-2" />
            <p className="text-sm">
              {canEditDocuments
                ? "No documents yet. Create one to keep project knowledge in one place."
                : "No documents have been added to this project yet."}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {documents.map((document) => (
              <div key={document.id} className="group relative rounded-xl border bg-card p-4 hover:shadow-md transition-all hover:border-primary/30">
                <Link href={`/projects/${projectId}/documents/${document.slug}`}>
                  <div className="cursor-pointer pr-8">
                    <h3 className="font-semibold group-hover:text-primary transition-colors">{document.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Updated {format(new Date(document.updatedAt), "MMM d, yyyy")}
                      {document.updatedByName ? ` by ${document.updatedByName}` : ""}
                    </p>
                  </div>
                </Link>
                {document.canEdit && (
                  <button
                    type="button"
                    title="Delete document"
                    onClick={() => {
                      if (confirm(`Delete document "${document.title}"?`)) deleteDocument.mutate(document.slug);
                    }}
                    className="absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-muted transition-all"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

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

        {activeBoards.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 py-12 text-center text-muted-foreground">
            <LayoutGrid className="mx-auto h-8 w-8 opacity-20 mb-2" />
            <p className="text-sm">No boards yet. Create one to start organizing work.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {activeBoards.map((board) => (
              <BoardCard
                key={board.id}
                board={board}
                projectId={projectId}
                onArchive={(id) => archiveBoard.mutate({ id, archived: true })}
                onDelete={(id) => {
                  if (confirm(`Delete board "${board.name}"?`)) deleteBoard.mutate(id);
                }}
              />
            ))}
          </div>
        )}

        {/* Archived boards */}
        {(archivedBoards.length > 0 || showArchivedBoards) && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowArchivedBoards((v) => !v)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              {showArchivedBoards ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Archive className="h-3 w-3" />
              Archived boards
              {archivedBoards.length > 0 && (
                <span className="text-xs bg-muted rounded-full px-2 py-0.5">{archivedBoards.length}</span>
              )}
            </button>

            {showArchivedBoards && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {archivedBoards.map((board) => (
                  <BoardCard
                    key={board.id}
                    board={board}
                    projectId={projectId}
                    onUnarchive={(id) => archiveBoard.mutate({ id, archived: false })}
                    onDelete={(id) => {
                      if (confirm(`Delete board "${board.name}"?`)) deleteBoard.mutate(id);
                    }}
                  />
                ))}
              </div>
            )}
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

function BoardCard({
  board,
  projectId,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  board: Board;
  projectId: number;
  onArchive?: (id: number) => void;
  onUnarchive?: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const isArchived = !!board.archivedAt;

  return (
    <div className={`group relative rounded-xl border bg-card p-4 hover:shadow-md transition-all hover:border-primary/30 ${isArchived ? "opacity-70" : ""}`}>
      <Link href={`/projects/${projectId}/boards/${board.id}`}>
        <div className="cursor-pointer">
          <h3 className="font-semibold group-hover:text-primary transition-colors pr-16">{board.name}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {isArchived
              ? `Archived ${format(new Date(board.archivedAt!), "MMM d, yyyy")}`
              : `Created ${format(new Date(board.createdAt), "MMM d, yyyy")}`}
          </p>
        </div>
      </Link>

      {/* Action buttons */}
      <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {isArchived && onUnarchive ? (
          <button
            type="button"
            title="Restore board"
            onClick={() => onUnarchive(board.id)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ArchiveRestore className="h-3.5 w-3.5" />
          </button>
        ) : !isArchived && onArchive ? (
          <button
            type="button"
            title="Archive board"
            onClick={() => onArchive(board.id)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          title="Delete board"
          onClick={() => onDelete(board.id)}
          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
