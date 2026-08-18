import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft, Plus, Trash2, Loader2, X, GripVertical, Calendar, User, Check, Pencil, Search,
  MessageSquare, Send,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format, isPast, isToday } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type CardMember = { id: number; name: string };
type Comment = {
  id: number;
  cardId: number;
  userId: number | null;
  content: string;
  createdAt: string;
  userName: string | null;
};
type Card = {
  id: number;
  columnId: number;
  title: string;
  description: string;
  dueDate: string | null;
  position: number;
  members: CardMember[];
};
type Column = { id: number; name: string; position: number; cards: Card[] };
type BoardData = { id: number; projectId: number; name: string; columns: Column[]; cardsTruncated?: boolean };
type ProjectMember = { id: number; name: string; email: string };

const colKey = (id: number) => `col-${id}`;
const colId = (key: string) => parseInt(key.replace("col-", ""));
const isColKey = (id: string | number): id is string =>
  typeof id === "string" && id.startsWith("col-");

// ─── Card chip (used in both board and drag overlay) ─────────────────────────

function CardChip({ card, onClick }: { card: Card; onClick?: () => void }) {
  const overdue =
    card.dueDate &&
    !isToday(new Date(card.dueDate)) &&
    isPast(new Date(card.dueDate));

  return (
    <div
      onClick={onClick}
      className="bg-card border rounded-lg p-3 shadow-sm space-y-2 cursor-pointer hover:shadow-md transition-shadow select-none"
    >
      <p className="text-sm font-medium leading-snug">{card.title}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {card.dueDate && (
          <span
            className={`flex items-center gap-1 text-xs rounded-full px-2 py-0.5 ${
              overdue
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <Calendar className="h-2.5 w-2.5" />
            {format(new Date(card.dueDate), "MMM d")}
          </span>
        )}
        {card.members.length > 0 && (
          <div className="flex items-center gap-0.5 ml-auto">
            {card.members.slice(0, 3).map((m) => (
              <div
                key={m.id}
                title={m.name}
                className="h-5 w-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[9px] font-bold ring-1 ring-background"
              >
                {m.name[0]?.toUpperCase()}
              </div>
            ))}
            {card.members.length > 3 && (
              <span className="text-[10px] text-muted-foreground ml-1">+{card.members.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SortableCard ─────────────────────────────────────────────────────────────

function SortableCard({ card, onClick }: { card: Card; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      className="relative group/card"
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute top-2.5 left-1.5 z-10 opacity-0 group-hover/card:opacity-40 hover:!opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground p-0.5 rounded transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>
      <div className="pl-5">
        <CardChip card={card} onClick={onClick} />
      </div>
    </div>
  );
}

// ─── KanbanColumn ─────────────────────────────────────────────────────────────

function KanbanColumn({
  column,
  cardIds,
  cardMap,
  onOpenCard,
  onAddCard,
  onDeleteColumn,
  onRenameColumn,
  isDraggingColumn,
}: {
  column: Column;
  cardIds: number[];
  cardMap: Record<number, Card>;
  onOpenCard: (id: number) => void;
  onAddCard: (columnId: number, title: string) => void;
  onDeleteColumn: (id: number) => void;
  onRenameColumn: (id: number, name: string) => void;
  isDraggingColumn: boolean;
}) {
  // Sortable for the column itself (drag to reorder columns)
  const {
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging: isColDragging,
    attributes,
    listeners,
  } = useSortable({ id: colKey(column.id) });

  // Droppable for card drop targets inside the column
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: colKey(column.id) });

  const [addingCard, setAddingCard] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [editing, setEditing] = useState(false);
  const [colName, setColName] = useState(column.name);
  const addCardRef = useRef<HTMLTextAreaElement>(null);

  const submitCard = () => {
    const t = newCardTitle.trim();
    if (!t) return;
    onAddCard(column.id, t);
    setNewCardTitle("");
    setTimeout(() => addCardRef.current?.focus(), 0);
  };

  const commitRename = () => {
    const n = colName.trim();
    if (n && n !== column.name) onRenameColumn(column.id, n);
    else setColName(column.name);
    setEditing(false);
  };

  return (
    <div
      ref={setSortableRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group/kanban-col w-72 shrink-0 flex flex-col rounded-xl border bg-muted/30 shadow-sm overflow-hidden transition-opacity ${isColDragging ? "opacity-40" : ""}`}
      {...attributes}
    >
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-2.5 border-b bg-muted/50">
        {/* Column drag handle */}
        <button
          type="button"
          className="shrink-0 p-0.5 rounded text-muted-foreground/30 group-hover/kanban-col:text-muted-foreground/50 hover:!text-muted-foreground cursor-grab active:cursor-grabbing transition-colors"
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder column"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        {editing ? (
          <>
            <input
              autoFocus
              className="flex-1 bg-transparent text-sm font-semibold outline-none border-b border-primary pb-0.5"
              value={colName}
              onChange={(e) => setColName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") { setColName(column.name); setEditing(false); }
              }}
            />
            <button type="button" onClick={commitRename} className="text-primary shrink-0">
              <Check className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="flex-1 text-left text-sm font-semibold hover:text-primary transition-colors group/col flex items-center gap-1"
              onClick={() => setEditing(true)}
            >
              {column.name}
              <Pencil className="h-3 w-3 opacity-0 group-hover/col:opacity-30 transition-opacity" />
            </button>
            <span className="text-xs text-muted-foreground tabular-nums">{cardIds.length}</span>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete column "${column.name}" and all its cards?`)) {
                  onDeleteColumn(column.id);
                }
              }}
              className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Cards */}
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setDroppableRef}
          className={`flex-1 min-h-[60px] flex flex-col gap-2 p-2 transition-colors ${isOver && !isDraggingColumn ? "bg-primary/5" : ""}`}
        >
          {cardIds.map((id) =>
            cardMap[id] ? (
              <SortableCard key={id} card={cardMap[id]} onClick={() => onOpenCard(id)} />
            ) : null,
          )}
        </div>
      </SortableContext>

      {/* Add card */}
      <div className="p-2 border-t">
        {addingCard ? (
          <div className="space-y-2">
            <textarea
              ref={addCardRef}
              autoFocus
              className="w-full text-sm bg-background border rounded-lg p-2 resize-none outline-none focus:ring-1 focus:ring-primary"
              rows={2}
              placeholder="Card title… (Enter to add, Shift+Enter for new line, Esc to close)"
              value={newCardTitle}
              onChange={(e) => setNewCardTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitCard(); }
                if (e.key === "Escape") { setAddingCard(false); setNewCardTitle(""); }
              }}
            />
            <div className="flex gap-1.5">
              <Button size="sm" onClick={submitCard} disabled={!newCardTitle.trim()}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setAddingCard(false); setNewCardTitle(""); }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingCard(true)}
            className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add card
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Card Detail Panel ────────────────────────────────────────────────────────

// ─── Member search picker ─────────────────────────────────────────────────────

function MemberPicker({
  projectMembers,
  assignedIds,
  onToggle,
}: {
  projectMembers: ProjectMember[];
  assignedIds: Set<number>;
  onToggle: (userId: number, add: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const assigned = projectMembers.filter((m) => assignedIds.has(m.id));
  const q = query.trim().toLowerCase();
  const unassigned = projectMembers.filter(
    (m) =>
      !assignedIds.has(m.id) &&
      (q === "" || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-2">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search members…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-lg bg-background outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(""); inputRef.current?.focus(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Assigned members — always visible at the top */}
      {assigned.length > 0 && (
        <div className="space-y-0.5">
          {assigned.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onToggle(m.id, false)}
              className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-sm bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
            >
              <div className="h-6 w-6 rounded-full bg-primary text-white flex items-center justify-center text-[10px] font-bold ring-1 ring-primary/30 shrink-0">
                {m.name[0]?.toUpperCase()}
              </div>
              <span className="flex-1 text-left truncate">{m.name}</span>
              <Check className="h-3.5 w-3.5 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Divider between assigned and search results */}
      {assigned.length > 0 && unassigned.length > 0 && (
        <div className="border-t" />
      )}

      {/* Unassigned members — filtered by search */}
      {unassigned.length > 0 ? (
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {unassigned.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onToggle(m.id, true)}
              className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-sm hover:bg-muted/50 text-foreground transition-colors"
            >
              <div className="h-6 w-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold ring-1 ring-border shrink-0">
                {m.name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="truncate">{m.name}</p>
                <p className="text-xs text-muted-foreground truncate">{m.email}</p>
              </div>
            </button>
          ))}
        </div>
      ) : query && assigned.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic px-3 py-2">No members match "{query}".</p>
      ) : null}
    </div>
  );
}

// ─── Card Detail Panel ────────────────────────────────────────────────────────

function CardDetailPanel({
  card,
  projectMembers,
  onClose,
  onUpdate,
  onDelete,
  onToggleMember,
}: {
  card: Card;
  projectMembers: ProjectMember[];
  onClose: () => void;
  onUpdate: (id: number, updates: { title?: string; description?: string; dueDate?: string | null }) => void;
  onDelete: (id: number) => void;
  onToggleMember: (cardId: number, userId: number, add: boolean) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [dueDate, setDueDate] = useState(card.dueDate ? card.dueDate.split("T")[0] : "");
  const [commentText, setCommentText] = useState("");
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const memberIds = new Set(card.members.map((m) => m.id));

  useEffect(() => {
    setTitle(card.title);
    setDescription(card.description);
    setDueDate(card.dueDate ? card.dueDate.split("T")[0] : "");
  }, [card.id]);

  // ── Comments ──────────────────────────────────────────────────────────────
  const commentsKey = ["card-comments", card.id];

  const { data: comments = [], isLoading: commentsLoading } = useQuery<Comment[]>({
    queryKey: commentsKey,
    queryFn: () => fetch(`/api/cards/${card.id}/comments`).then((r) => r.json()),
  });

  const addComment = useMutation({
    mutationFn: (content: string) =>
      fetch(`/api/cards/${card.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsKey });
      setCommentText("");
      setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
  });

  const deleteComment = useMutation({
    mutationFn: (commentId: number) =>
      fetch(`/api/cards/${card.id}/comments/${commentId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey }),
  });

  const submitComment = () => {
    const text = commentText.trim();
    if (!text) return;
    addComment.mutate(text);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="relative bg-background w-full max-w-md h-full shadow-2xl border-l overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-background z-10">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Card</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { if (confirm("Delete this card?")) { onDelete(card.id); onClose(); } }}
              className="text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 p-5 space-y-6">
          {/* Title */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Title</label>
            <input
              className="w-full text-base font-semibold bg-transparent outline-none border-b border-transparent hover:border-border focus:border-primary pb-1 transition-colors"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => { if (title.trim() !== card.title) onUpdate(card.id, { title: title.trim() }); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Description</label>
            <textarea
              className="w-full text-sm bg-muted/30 border rounded-lg p-3 resize-none outline-none focus:ring-1 focus:ring-primary min-h-[80px]"
              placeholder="Add a description…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => { if (description !== card.description) onUpdate(card.id, { description }); }}
            />
          </div>

          {/* Due Date */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Due Date
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="border rounded-lg px-3 py-1.5 text-sm bg-background outline-none focus:ring-1 focus:ring-primary"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  onUpdate(card.id, { dueDate: e.target.value || null });
                }}
              />
              {dueDate && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => { setDueDate(""); onUpdate(card.id, { dueDate: null }); }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Members */}
          {projectMembers.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Assigned To
              </label>
              <MemberPicker
                projectMembers={projectMembers}
                assignedIds={memberIds}
                onToggle={(userId, add) => onToggleMember(card.id, userId, add)}
              />
            </div>
          )}

          {/* Comments */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" /> Comments
              {comments.length > 0 && (
                <span className="text-muted-foreground/60 normal-case font-normal">({comments.length})</span>
              )}
            </label>

            {/* Comment list */}
            <div className="space-y-3 mb-3">
              {commentsLoading && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {!commentsLoading && comments.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">No comments yet.</p>
              )}
              {comments.map((c) => (
                <div key={c.id} className="group flex gap-2.5">
                  <div className="shrink-0 h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold uppercase">
                    {c.userName ? c.userName.slice(0, 2) : "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-xs font-semibold truncate">{c.userName ?? "Unknown"}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {format(new Date(c.createdAt), "MMM d, h:mm a")}
                      </span>
                    </div>
                    <p className="text-sm leading-snug whitespace-pre-wrap break-words">{c.content}</p>
                  </div>
                  {(c.userId === user?.id || user?.role === "admin") && (
                    <button
                      type="button"
                      onClick={() => deleteComment.mutate(c.id)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all self-start mt-0.5"
                      aria-label="Delete comment"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              <div ref={commentsEndRef} />
            </div>

            {/* New comment input */}
            <div className="flex gap-2 items-end">
              <textarea
                className="flex-1 text-sm bg-muted/30 border rounded-lg px-3 py-2 resize-none outline-none focus:ring-1 focus:ring-primary min-h-[60px]"
                placeholder="Write a comment…"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitComment();
                }}
              />
              <button
                type="button"
                onClick={submitComment}
                disabled={!commentText.trim() || addComment.isPending}
                className="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                aria-label="Post comment"
              >
                {addComment.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">⌘↵ to submit</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Board Page ───────────────────────────────────────────────────────────────

export default function BoardPage({ params }: { params: { projectId: string; boardId: string } }) {
  const boardId = Number(params.boardId);
  const projectId = Number(params.projectId);
  const qc = useQueryClient();

  const { data: boardData, isLoading } = useQuery<BoardData>({
    queryKey: ["board", boardId],
    queryFn: () => fetch(`/api/boards/${boardId}`).then((r) => r.json()),
  });

  const { data: projectMembers = [] } = useQuery<ProjectMember[]>({
    queryKey: ["project-members", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}/members`).then((r) => r.json()),
  });

  // ── DnD state ──
  const [items, setItems] = useState<Record<string, number[]>>({});
  const [columnOrder, setColumnOrder] = useState<number[]>([]);
  const [activeCardId, setActiveCardId] = useState<number | null>(null);
  const [activeColumnKey, setActiveColumnKey] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);

  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const columnOrderRef = useRef(columnOrder);
  useEffect(() => { columnOrderRef.current = columnOrder; }, [columnOrder]);

  // When true, the next boardData-triggered sync is skipped once.
  const skipNextSyncRef = useRef(false);

  // Sync from server data — skipped while dragging, and once after each drop.
  useEffect(() => {
    if (activeCardId !== null || activeColumnKey !== null || !boardData) return;
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }
    const newItems: Record<string, number[]> = {};
    for (const col of boardData.columns) {
      newItems[colKey(col.id)] = [...col.cards]
        .sort((a, b) => a.position - b.position)
        .map((c) => c.id);
    }
    setItems(newItems);
    setColumnOrder(
      [...boardData.columns]
        .sort((a, b) => a.position - b.position)
        .map((c) => c.id),
    );
  }, [boardData, activeCardId, activeColumnKey]);

  // Card map for fast lookup
  const cardMap = useMemo<Record<number, Card>>(() => {
    const map: Record<number, Card> = {};
    if (!boardData) return map;
    for (const col of boardData.columns)
      for (const card of col.cards) map[card.id] = card;
    return map;
  }, [boardData]);

  const columnMap = useMemo<Record<number, Column>>(() => {
    const map: Record<number, Column> = {};
    if (!boardData) return map;
    for (const col of boardData.columns) map[col.id] = col;
    return map;
  }, [boardData]);

  const findContainer = useCallback(
    (id: number | string): string | null => {
      const key = String(id);
      if (key in items) return key;
      const numId = Number(id);
      return Object.keys(items).find((k) => items[k].includes(numId)) ?? null;
    },
    [items],
  );

  // ── DnD handlers ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  function onDragStart({ active }: DragStartEvent) {
    const id = active.id;
    if (isColKey(id)) {
      setActiveColumnKey(id);
    } else {
      setActiveCardId(id as number);
    }
  }

  function onDragOver({ active, over }: DragOverEvent) {
    // Column reordering is handled entirely in onDragEnd
    if (isColKey(active.id)) return;

    if (!over) return;
    const ac = findContainer(active.id as number);
    const oc = findContainer(over.id as number | string) ?? (isColKey(over.id) ? String(over.id) : null);
    if (!ac || !oc || ac === oc) return;

    setItems((prev) => {
      const activeItems = prev[ac].filter((id) => id !== active.id);
      const overItems = [...(prev[oc] ?? [])];
      const overIndex = overItems.indexOf(over.id as number);
      const insertAt = overIndex >= 0 ? overIndex : overItems.length;
      return {
        ...prev,
        [ac]: activeItems,
        [oc]: [...overItems.slice(0, insertAt), active.id as number, ...overItems.slice(insertAt)],
      };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    skipNextSyncRef.current = true;

    // ── Column reorder ──
    if (isColKey(active.id)) {
      setActiveColumnKey(null);
      if (!over || active.id === over.id) return;
      const oldIdx = columnOrderRef.current.indexOf(colId(active.id));
      const newIdx = isColKey(over.id)
        ? columnOrderRef.current.indexOf(colId(over.id))
        : -1;
      if (oldIdx !== -1 && newIdx !== -1) {
        const newOrder = arrayMove(columnOrderRef.current, oldIdx, newIdx);
        setColumnOrder(newOrder);
        columnOrderRef.current = newOrder;
      }
      setTimeout(() => persistColumnOrder(), 0);
      return;
    }

    // ── Card reorder / move ──
    setActiveCardId(null);
    if (!over) return;
    const ac = findContainer(active.id as number);
    const oc = findContainer(over.id as number | string) ?? (isColKey(over.id) ? String(over.id) : null);
    if (!ac || !oc) return;

    if (ac === oc) {
      const activeIndex = items[ac].indexOf(active.id as number);
      const overIndex = items[oc].indexOf(over.id as number);
      if (activeIndex !== overIndex) {
        setItems((prev) => ({
          ...prev,
          [ac]: arrayMove(prev[ac], activeIndex, overIndex),
        }));
      }
    }
    setTimeout(() => persistReorder(), 0);
  }

  const persistReorder = useCallback(() => {
    const cols = Object.entries(itemsRef.current).map(([key, cardIds]) => ({
      columnId: colId(key),
      cardIds,
    }));
    fetch(`/api/boards/${boardId}/cards/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns: cols }),
    }).then(() => qc.invalidateQueries({ queryKey: ["board", boardId] }));
  }, [boardId, qc]);

  const persistColumnOrder = useCallback(() => {
    fetch(`/api/boards/${boardId}/columns/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnIds: columnOrderRef.current }),
    }).then(() => qc.invalidateQueries({ queryKey: ["board", boardId] }));
  }, [boardId, qc]);

  // ── Mutations ──
  const invalidateBoard = () => qc.invalidateQueries({ queryKey: ["board", boardId] });

  const addColumn = useMutation({
    mutationFn: (name: string) =>
      fetch(`/api/boards/${boardId}/columns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    onSuccess: invalidateBoard,
  });

  const deleteColumn = useMutation({
    mutationFn: (id: number) => fetch(`/api/columns/${id}`, { method: "DELETE" }),
    onSuccess: invalidateBoard,
  });

  const renameColumn = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      fetch(`/api/columns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    onSuccess: invalidateBoard,
  });

  const addCard = useMutation({
    mutationFn: ({ columnId, title }: { columnId: number; title: string }) =>
      fetch(`/api/columns/${columnId}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }),
    onSuccess: invalidateBoard,
  });

  const updateCard = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Record<string, unknown> }) =>
      fetch(`/api/cards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      }),
    onSuccess: invalidateBoard,
  });

  const deleteCard = useMutation({
    mutationFn: (id: number) => fetch(`/api/cards/${id}`, { method: "DELETE" }),
    onSuccess: invalidateBoard,
  });

  const toggleMember = useMutation({
    mutationFn: ({ cardId, userId, add }: { cardId: number; userId: number; add: boolean }) =>
      add
        ? fetch(`/api/cards/${cardId}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
          })
        : fetch(`/api/cards/${cardId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: invalidateBoard,
  });

  // ── Add column inline ──
  const [showAddCol, setShowAddCol] = useState(false);
  const [newColName, setNewColName] = useState("");

  const submitAddCol = () => {
    const n = newColName.trim();
    if (!n) return;
    addColumn.mutate(n);
    setNewColName("");
    setShowAddCol(false);
  };

  // ── Selected card for detail panel ──
  const selectedCard = selectedCardId ? cardMap[selectedCardId] : null;

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!boardData) return <div className="text-center py-20 text-muted-foreground">Board not found.</div>;

  const isDraggingColumn = activeColumnKey !== null;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* Board toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b bg-background shrink-0">
        <Link href={`/projects/${projectId}`}>
          <button type="button" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        </Link>
        <div className="h-4 w-px bg-border" />
        <h1 className="font-semibold text-sm">{boardData.name}</h1>
      </div>

      {/* Card cap notice */}
      {boardData.cardsTruncated && (
        <div className="shrink-0 px-6 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
          <span className="font-medium">Showing first 300 cards.</span>
          <span className="text-amber-700 dark:text-amber-400">Complete or delete cards to reduce the board size.</span>
        </div>
      )}

      {/* Kanban canvas */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          {/* Outer SortableContext for column order */}
          <SortableContext items={columnOrder.map(colKey)} strategy={horizontalListSortingStrategy}>
            <div className="flex gap-4 items-start h-full p-6">
              {columnOrder.map((cId) => {
                const col = columnMap[cId];
                if (!col) return null;
                return (
                  <KanbanColumn
                    key={cId}
                    column={col}
                    cardIds={items[colKey(cId)] ?? []}
                    cardMap={cardMap}
                    onOpenCard={setSelectedCardId}
                    onAddCard={(colId, title) => addCard.mutate({ columnId: colId, title })}
                    onDeleteColumn={(id) => deleteColumn.mutate(id)}
                    onRenameColumn={(id, name) => renameColumn.mutate({ id, name })}
                    isDraggingColumn={isDraggingColumn}
                  />
                );
              })}

              {/* Add column */}
              {showAddCol ? (
                <div className="w-72 shrink-0 rounded-xl border bg-muted/30 p-3 space-y-2 shadow-sm">
                  <Input
                    autoFocus
                    placeholder="Column name…"
                    value={newColName}
                    onChange={(e) => setNewColName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitAddCol();
                      if (e.key === "Escape") { setShowAddCol(false); setNewColName(""); }
                    }}
                  />
                  <div className="flex gap-1.5">
                    <Button size="sm" onClick={submitAddCol} disabled={!newColName.trim()}>Add Column</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowAddCol(false); setNewColName(""); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddCol(true)}
                  className="w-72 shrink-0 flex items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 py-4 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                  <Plus className="h-4 w-4" /> Add Column
                </button>
              )}
            </div>
          </SortableContext>

          <DragOverlay>
            {activeCardId && cardMap[activeCardId] ? (
              <div className="w-64 rotate-1 shadow-xl opacity-95">
                <CardChip card={cardMap[activeCardId]} />
              </div>
            ) : activeColumnKey ? (
              <div className="w-72 rounded-xl border bg-muted/30 shadow-2xl opacity-95 overflow-hidden rotate-1">
                <div className="flex items-center gap-1 px-2 py-2.5 border-b bg-muted/50">
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                  <span className="text-sm font-semibold flex-1 truncate">
                    {columnMap[colId(activeColumnKey)]?.name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {(items[activeColumnKey] ?? []).length}
                  </span>
                </div>
                <div className="px-3 py-2 text-xs text-muted-foreground italic">
                  Drop to reorder…
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Card detail panel */}
      {selectedCard && (
        <CardDetailPanel
          card={selectedCard}
          projectMembers={projectMembers}
          onClose={() => setSelectedCardId(null)}
          onUpdate={(id, updates) => updateCard.mutate({ id, updates })}
          onDelete={(id) => deleteCard.mutate(id)}
          onToggleMember={(cardId, userId, add) => toggleMember.mutate({ cardId, userId, add })}
        />
      )}
    </div>
  );
}
