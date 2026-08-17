import { Router } from "express";
import { db, taskListsTable, tasksTable, siteSettingsTable } from "@workspace/db";
import { eq, and, asc, inArray, max, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();

// Feature flag — admins always bypass; others blocked if tasks_enabled = "false"
router.use(async (req, res, next) => {
  if (!req.session?.userId) { next(); return; }
  if (req.session.userRole === "admin") { next(); return; }
  const [row] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, "tasks_enabled")).limit(1);
  if (row?.value === "false") {
    res.status(403).json({ error: "Tasks feature is disabled" });
    return;
  }
  next();
});

// GET /api/tasks/lists — all lists with embedded tasks for the current user
// Safety cap: at most 200 tasks returned in total to keep responses bounded.
const TASKS_CAP = 200;

router.get("/tasks/lists", requireAuth, async (req, res) => {
  const userId = req.session.userId!;

  // Fetch lists owned by this user, then tasks that belong to those lists.
  // Ownership is tracked on task_lists.user_id — no user_id column needed on tasks.
  const lists = await db
    .select()
    .from(taskListsTable)
    .where(eq(taskListsTable.userId, userId))
    .orderBy(asc(taskListsTable.createdAt), asc(taskListsTable.id));

  const allTasks = lists.length > 0
    ? await db
        .select()
        .from(tasksTable)
        .where(inArray(tasksTable.listId, lists.map((l) => l.id)))
        // id is the unique tie-breaker so the cap is deterministic even when
        // position and created_at values collide.
        .orderBy(asc(tasksTable.position), asc(tasksTable.createdAt), asc(tasksTable.id))
        .limit(TASKS_CAP + 1)
    : [];

  const truncated = allTasks.length > TASKS_CAP;
  const tasks = truncated ? allTasks.slice(0, TASKS_CAP) : allTasks;

  res.json({
    lists: lists.map((list) => ({ ...list, tasks: tasks.filter((t) => t.listId === list.id) })),
    truncated,
  });
});

// POST /api/tasks/lists — create a list
router.post("/tasks/lists", requireAuth, async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  const [list] = await db
    .insert(taskListsTable)
    .values({ userId: req.session.userId!, name: name.trim() })
    .returning();
  res.status(201).json(list);
});

// PATCH /api/tasks/lists/:id — rename a list
router.patch("/tasks/lists/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  const [list] = await db
    .update(taskListsTable)
    .set({ name: name.trim() })
    .where(and(eq(taskListsTable.id, id), eq(taskListsTable.userId, req.session.userId!)))
    .returning();
  if (!list) {
    res.status(404).json({ error: "List not found" });
    return;
  }
  res.json(list);
});

// DELETE /api/tasks/lists/:id — delete a list (tasks cascade)
router.delete("/tasks/lists/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [deleted] = await db
    .delete(taskListsTable)
    .where(and(eq(taskListsTable.id, id), eq(taskListsTable.userId, req.session.userId!)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "List not found" });
    return;
  }
  res.status(204).send();
});

// POST /api/tasks — create a task
router.post("/tasks", requireAuth, async (req, res) => {
  const { listId, title } = req.body as { listId?: number; title?: string };
  if (!title?.trim()) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  // Verify the list belongs to this user
  const [list] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.id, Number(listId)), eq(taskListsTable.userId, req.session.userId!)))
    .limit(1);
  if (!list) {
    res.status(404).json({ error: "List not found" });
    return;
  }
  // Place new task at the end of active (non-completed) tasks
  const [{ maxPos }] = await db
    .select({ maxPos: max(tasksTable.position) })
    .from(tasksTable)
    .where(and(eq(tasksTable.listId, list.id), sql`${tasksTable.completedAt} IS NULL`));
  const position = (maxPos ?? -1) + 1;

  const [task] = await db
    .insert(tasksTable)
    .values({ listId: list.id, title: title.trim(), position })
    .returning();
  res.status(201).json(task);
});

// PATCH /api/tasks/lists/:listId/reorder — persist drag-and-drop order
router.patch("/tasks/lists/:listId/reorder", requireAuth, async (req, res) => {
  const listId = Number(req.params.listId);
  const { taskIds } = req.body as { taskIds?: number[] };

  if (!Array.isArray(taskIds)) {
    res.status(400).json({ error: "taskIds must be an array" });
    return;
  }

  // Verify the list belongs to this user
  const [list] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.id, listId), eq(taskListsTable.userId, req.session.userId!)))
    .limit(1);
  if (!list) {
    res.status(404).json({ error: "List not found" });
    return;
  }

  // Update each task's position in parallel (list ownership already verified above)
  await Promise.all(
    taskIds.map((id, index) =>
      db
        .update(tasksTable)
        .set({ position: index })
        .where(and(eq(tasksTable.id, id), eq(tasksTable.listId, listId)))
    )
  );

  res.json({ ok: true });
});

// PATCH /api/tasks/:id — toggle completion or rename
router.patch("/tasks/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { completed, title } = req.body as { completed?: boolean; title?: string };

  // Verify ownership via the task's list
  const [owned] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .innerJoin(
      taskListsTable,
      and(eq(tasksTable.listId, taskListsTable.id), eq(taskListsTable.userId, req.session.userId!))
    )
    .where(eq(tasksTable.id, id))
    .limit(1);
  if (!owned) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title.trim();
  if (completed !== undefined) updates.completedAt = completed ? new Date() : null;

  const [task] = await db
    .update(tasksTable)
    .set(updates)
    .where(eq(tasksTable.id, id))
    .returning();
  res.json(task);
});

// DELETE /api/tasks/:id — delete a task
router.delete("/tasks/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  // Verify ownership via the task's list
  const [owned] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .innerJoin(
      taskListsTable,
      and(eq(tasksTable.listId, taskListsTable.id), eq(taskListsTable.userId, req.session.userId!))
    )
    .where(eq(tasksTable.id, id))
    .limit(1);
  if (!owned) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  res.status(204).send();
});

export default router;
