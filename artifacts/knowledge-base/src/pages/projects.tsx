import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, FolderKanban, Loader2, X, LayoutGrid } from "lucide-react";
import { format } from "date-fns";

type Project = {
  id: number;
  name: string;
  description: string;
  createdById: number | null;
  boardCount: number;
  createdAt: string;
  updatedAt: string;
};

export default function ProjectsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => fetch("/api/projects").then((r) => r.json()),
  });

  const createProject = useMutation({
    mutationFn: () =>
      fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setDescription("");
      setShowForm(false);
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

      {/* Project list */}
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
            <Link key={project.id} href={`/projects/${project.id}`}>
              <div className="group rounded-xl border bg-card p-5 hover:shadow-md transition-all cursor-pointer hover:border-primary/30 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-base group-hover:text-primary transition-colors leading-snug">
                    {project.name}
                  </h3>
                  <FolderKanban className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                </div>
                {project.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{project.description}</p>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1 border-t border-border/50">
                  <span className="flex items-center gap-1">
                    <LayoutGrid className="h-3 w-3" />
                    {project.boardCount} {project.boardCount === 1 ? "board" : "boards"}
                  </span>
                  <span className="ml-auto">
                    Updated {format(new Date(project.updatedAt), "MMM d")}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
