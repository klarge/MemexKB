import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, FolderKanban, Loader2, X, LayoutGrid, Archive, ArchiveRestore, ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";

type Project = {
  id: number;
  name: string;
  description: string;
  createdById: number | null;
  boardCount: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function ProjectsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const { data: projectsData, isLoading } = useQuery<{ projects: Project[]; truncated: boolean }>({
    queryKey: ["projects"],
    queryFn: () => fetch("/api/projects").then((r) => r.json()),
  });

  const { data: archivedData } = useQuery<{ projects: Project[]; truncated: boolean }>({
    queryKey: ["projects-archived"],
    queryFn: () => fetch("/api/projects?archived=true").then((r) => r.json()),
    enabled: showArchived,
  });

  const projects = projectsData?.projects ?? [];
  const projectsTruncated = projectsData?.truncated ?? false;
  const archivedProjects = archivedData?.projects ?? [];

  const createProject = useMutation({
    mutationFn: () =>
      fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setName(""); setDescription(""); setShowForm(false);
    },
  });

  const archiveProject = useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["projects-archived"] });
    },
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FolderKanban className="h-6 w-6" />
            Projects
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Kanban boards for collaborative project work.
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Project
          </Button>
        )}
      </div>

      {/* New project form */}
      {showForm && (
        <div className="rounded-xl border bg-card p-5 space-y-3 shadow-sm">
          <h2 className="font-semibold text-sm">New Project</h2>
          <Input
            autoFocus
            placeholder="Project name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) createProject.mutate();
              if (e.key === "Escape") { setShowForm(false); setName(""); setDescription(""); }
            }}
          />
          <Input
            placeholder="Description (optional)…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex gap-2">
            <Button onClick={() => createProject.mutate()} disabled={!name.trim() || createProject.isPending}>
              {createProject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Project"}
            </Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setName(""); setDescription(""); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Truncation notice */}
      {projectsTruncated && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <span className="font-medium">Showing first 100 projects.</span>{" "}
          <span className="text-amber-700 dark:text-amber-400">Delete unused projects to see all items.</span>
        </div>
      )}

      {/* Active project list */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <FolderKanban className="mx-auto h-12 w-12 opacity-20 mb-4" />
          <p className="font-medium">No projects yet</p>
          <p className="text-sm mt-1">Create a project to get started with Kanban boards.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onArchive={(id) => archiveProject.mutate({ id, archived: true })}
            />
          ))}
        </div>
      )}

      {/* Archived section */}
      <div>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          {showArchived ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Archive className="h-3.5 w-3.5" />
          Archived projects
          {archivedProjects.length > 0 && (
            <span className="text-xs bg-muted rounded-full px-2 py-0.5">{archivedProjects.length}</span>
          )}
        </button>

        {showArchived && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {archivedProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground col-span-full py-4 text-center">No archived projects.</p>
            ) : (
              archivedProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onUnarchive={(id) => archiveProject.mutate({ id, archived: false })}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  onArchive,
  onUnarchive,
}: {
  project: Project;
  onArchive?: (id: number) => void;
  onUnarchive?: (id: number) => void;
}) {
  const isArchived = !!project.archivedAt;

  return (
    <div className={`group relative rounded-xl border bg-card p-5 hover:shadow-md transition-all hover:border-primary/30 space-y-3 ${isArchived ? "opacity-70" : ""}`}>
      <Link href={`/projects/${project.id}`}>
        <div className="cursor-pointer">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-base group-hover:text-primary transition-colors leading-snug">
              {project.name}
            </h3>
            <FolderKanban className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          </div>
          {project.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{project.description}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-3 border-t border-border/50 mt-3">
            <span className="flex items-center gap-1">
              <LayoutGrid className="h-3 w-3" />
              {project.boardCount} {project.boardCount === 1 ? "board" : "boards"}
            </span>
            {isArchived ? (
              <span className="ml-auto flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Archive className="h-3 w-3" /> Archived
              </span>
            ) : (
              <span className="ml-auto">Updated {format(new Date(project.updatedAt), "MMM d")}</span>
            )}
          </div>
        </div>
      </Link>

      {/* Archive / unarchive button */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        {isArchived && onUnarchive ? (
          <button
            type="button"
            title="Restore project"
            onClick={(e) => { e.preventDefault(); onUnarchive(project.id); }}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ArchiveRestore className="h-3.5 w-3.5" />
          </button>
        ) : !isArchived && onArchive ? (
          <button
            type="button"
            title="Archive project"
            onClick={(e) => { e.preventDefault(); onArchive(project.id); }}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
