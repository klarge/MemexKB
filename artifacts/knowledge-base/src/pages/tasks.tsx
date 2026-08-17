import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  Trash2,
  ListTodo,
  ChevronDown,
  ChevronRight,
  Loader2,
  Circle,
  CheckCircle2,
  Pencil,
  Check,
  X,
  GripVertical,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Task = {
  id: number;
  listId: number;
  title: string;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TaskList = {
  id: number;
  name: string;
  tasks: Task[];
  createdAt: string;
};

// ─── API helpers ──────────────────────────────────────────────────────────────

const json = (method: string, url: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

// ─── SortableTaskItem ─────────────────────────────────────────────────────────

function SortableTaskItem({
  task,
  onToggle,
  onDelete,
}: {
  task: Task;
  onToggle: (id: number, completed: boolean) => void;
  onDelete: (id: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const done = task.completedAt !== null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-2 px-3 py-2 hover:bg-muted/40 rounded-md transition-colors"
    >
      {/* Drag handle — only shown for active (non-completed) tasks */}
      <button
        type="button"
        className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors touch-none opacity-0 group-hover:opacity-100"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={() => onToggle(task.id, !done)}
        className="shrink-0 transition-colors text-muted-foreground hover:text-primary"
        aria-label={done ? "Mark incomplete" : "Mark complete"}
      >
        {done ? (
          <CheckCircle2 className="h-[18px] w-[18px] text-primary" />
        ) : (
          <Circle className="h-[18px] w-[18px]" />
        )}
      </button>

      <span
        className={`flex-1 text-sm leading-snug select-none ${
          done ? "line-through text-muted-foreground" : ""
        }`}
      >
        {task.title}
      </span>

      <button
        type="button"
        onClick={() => onDelete(task.id)}
        className={`shrink-0 transition-all text-muted-foreground hover:text-destructive ${
          done ? "opacity-50 hover:opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
        aria-label="Delete task"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── AddTaskRow ───────────────────────────────────────────────────────────────

function AddTaskRow({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState("");

  const submit = () => {
    const t = value.trim();
    if (!t) return;
    onAdd(t);
    setValue("");
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      {/* Spacer to align with drag handle */}
      <span className="w-4 shrink-0" />
      <Plus className="h-[18px] w-[18px] text-muted-foreground/60 shrink-0" />
      <input
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 leading-snug"
        placeholder="Add a task…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setValue("");
        }}
      />
    </div>
  );
}

// ─── ListCard ─────────────────────────────────────────────────────────────────

function ListCard({
  list,
  onDeleteList,
  onRenameList,
  onAddTask,
  onToggleTask,
  onDeleteTask,
  onReorderTasks,
}: {
  list: TaskList;
  onDeleteList: (id: number) => void;
  onRenameList: (id: number, name: string) => void;
  onAddTask: (listId: number, title: string) => void;
  onToggleTask: (id: number, completed: boolean) => void;
  onDeleteTask: (id: number) => void;
  onReorderTasks: (listId: number, taskIds: number[]) => void;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(list.name);

  // Keep a local optimistic order for active tasks
  const [localActiveIds, setLocalActiveIds] = useState<number[] | null>(null);

  const activeTasks = list.tasks
    .filter((t) => t.completedAt === null)
    .sort((a, b) => a.position - b.position);

  const completedTasks = list.tasks
    .filter((t) => t.completedAt !== null)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime());

  // Derive the display order: use optimistic ids if a drag just happened
  const activeTasksOrdered = localActiveIds
    ? localActiveIds
        .map((id) => activeTasks.find((t) => t.id === id))
        .filter((t): t is Task => t !== undefined)
    : activeTasks;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = activeTasksOrdered.map((t) => t.id);
    const oldIndex = ids.indexOf(Number(active.id));
    const newIndex = ids.indexOf(Number(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(ids, oldIndex, newIndex);
    setLocalActiveIds(reordered);
    onReorderTasks(list.id, reordered);
  };

  const commitRename = () => {
    const n = nameValue.trim();
    if (n && n !== list.name) onRenameList(list.id, n);
    else setNameValue(list.name);
    setEditing(false);
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/25">
        {editing ? (
          <>
            <input
              autoFocus
              className="flex-1 font-semibold text-sm bg-transparent outline-none border-b border-primary pb-0.5"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setNameValue(list.name);
                  setEditing(false);
                }
              }}
            />
            <button
              type="button"
              onClick={commitRename}
              className="text-primary hover:text-primary/80 transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="flex-1 text-left font-semibold text-sm hover:text-primary transition-colors group/name flex items-center gap-1.5"
              onClick={() => setEditing(true)}
              title="Click to rename"
            >
              {list.name}
              <Pencil className="h-3 w-3 opacity-0 group-hover/name:opacity-40 transition-opacity" />
            </button>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {activeTasks.length} remaining
            </span>
            <button
              type="button"
              onClick={() => onDeleteList(list.id)}
              className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
              aria-label="Delete list"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Active tasks — sortable */}
      <div className="py-1">
        {activeTasks.length === 0 && (
          <p className="px-10 py-2 text-xs text-muted-foreground/60 italic">
            No tasks yet — add one below.
          </p>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={activeTasksOrdered.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {activeTasksOrdered.map((task) => (
              <SortableTaskItem
                key={task.id}
                task={task}
                onToggle={(id, completed) => {
                  // Remove from local order when completed
                  if (completed && localActiveIds) {
                    setLocalActiveIds(localActiveIds.filter((i) => i !== id));
                  }
                  onToggleTask(id, completed);
                }}
                onDelete={(id) => {
                  if (localActiveIds) {
                    setLocalActiveIds(localActiveIds.filter((i) => i !== id));
                  }
                  onDeleteTask(id);
                }}
              />
            ))}
          </SortableContext>
        </DndContext>

        <AddTaskRow
          onAdd={(title) => {
            setLocalActiveIds(null); // reset local order so new task appears at end
            onAddTask(list.id, title);
          }}
        />
      </div>

      {/* Completed section */}
      {completedTasks.length > 0 && (
        <div className="border-t">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setShowCompleted((s) => !s)}
              className="flex items-center gap-1.5 flex-1 px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showCompleted ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {completedTasks.length}{" "}
              {completedTasks.length === 1 ? "completed task" : "completed tasks"}
            </button>
            <button
              type="button"
              onClick={() => completedTasks.forEach((t) => onDeleteTask(t.id))}
              className="px-3 py-2.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
              aria-label="Delete all completed tasks"
              title="Delete all completed"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {showCompleted && (
            <div className="pb-1 bg-muted/10">
              {completedTasks.map((task) => (
                <SortableTaskItem
                  key={task.id}
                  task={task}
                  onToggle={onToggleTask}
                  onDelete={onDeleteTask}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const qc = useQueryClient();
  const [newListName, setNewListName] = useState("");
  const [showNewList, setShowNewList] = useState(false);

  const { data: listsData, isLoading } = useQuery<{ lists: TaskList[]; truncated: boolean }>({
    queryKey: ["task-lists"],
    queryFn: () => fetch("/api/tasks/lists").then((r) => r.json()),
  });
  const lists = listsData?.lists ?? [];
  const tasksTruncated = listsData?.truncated ?? false;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["task-lists"] });

  const createList = useMutation({
    mutationFn: (name: string) => json("POST", "/api/tasks/lists", { name }),
    onSuccess: () => {
      invalidate();
      setNewListName("");
      setShowNewList(false);
    },
  });

  const renameList = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      json("PATCH", `/api/tasks/lists/${id}`, { name }),
    onSuccess: invalidate,
  });

  const deleteList = useMutation({
    mutationFn: (id: number) => fetch(`/api/tasks/lists/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const addTask = useMutation({
    mutationFn: ({ listId, title }: { listId: number; title: string }) =>
      json("POST", "/api/tasks", { listId, title }),
    onSuccess: invalidate,
  });

  const toggleTask = useMutation({
    mutationFn: ({ id, completed }: { id: number; completed: boolean }) =>
      json("PATCH", `/api/tasks/${id}`, { completed }),
    onSuccess: invalidate,
  });

  const deleteTask = useMutation({
    mutationFn: (id: number) => fetch(`/api/tasks/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const reorderTasks = useMutation({
    mutationFn: ({ listId, taskIds }: { listId: number; taskIds: number[] }) =>
      json("PATCH", `/api/tasks/lists/${listId}/reorder`, { taskIds }),
    // No invalidate — optimistic local state handles the UI; server syncs quietly
  });

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ListTodo className="h-6 w-6" />
            Tasks
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Personal to-do lists, visible only to you.
          </p>
        </div>
        {!showNewList && (
          <Button onClick={() => setShowNewList(true)}>
            <Plus className="mr-2 h-4 w-4" /> New List
          </Button>
        )}
      </div>

      {/* New list form */}
      {showNewList && (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            placeholder="List name…"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateList();
              if (e.key === "Escape") {
                setShowNewList(false);
                setNewListName("");
              }
            }}
            className="max-w-xs"
          />
          <Button
            onClick={handleCreateList}
            disabled={!newListName.trim() || createList.isPending}
          >
            {createList.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Create"
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setShowNewList(false);
              setNewListName("");
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Truncation notice */}
      {tasksTruncated && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <span className="font-medium">Showing first 200 tasks.</span>{" "}
          <span className="text-amber-700 dark:text-amber-400">Complete or delete tasks to see all items, or use search to find specific ones.</span>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : lists.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <ListTodo className="mx-auto h-12 w-12 opacity-20 mb-4" />
          <p className="font-medium">No lists yet</p>
          <p className="text-sm mt-1">
            Click <span className="font-medium text-foreground">New List</span> to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {lists.map((list) => (
            <ListCard
              key={list.id}
              list={list}
              onDeleteList={(id) => deleteList.mutate(id)}
              onRenameList={(id, name) => renameList.mutate({ id, name })}
              onAddTask={(listId, title) => addTask.mutate({ listId, title })}
              onToggleTask={(id, completed) => toggleTask.mutate({ id, completed })}
              onDeleteTask={(id) => deleteTask.mutate(id)}
              onReorderTasks={(listId, taskIds) => reorderTasks.mutate({ listId, taskIds })}
            />
          ))}
        </div>
      )}
    </div>
  );

  function handleCreateList() {
    const name = newListName.trim();
    if (!name) return;
    createList.mutate(name);
  }
}
