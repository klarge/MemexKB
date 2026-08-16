import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { BottomTabBar } from '@/components/BottomTabBar';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Task {
  id: number;
  title: string;
  completedAt: string | null;
  position: number;
  createdAt: string;
}

interface TaskList {
  id: number;
  name: string;
  tasks: Task[];
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  onToggle,
}: {
  task: Task;
  onToggle: () => void;
}) {
  const colors = useColors();
  const done = task.completedAt !== null;
  const s = taskRowStyles(colors);

  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
      onPress={onToggle}
    >
      <View style={[s.checkbox, done && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
        {done && <Feather name="check" size={11} color="#fff" />}
      </View>
      <Text style={[s.title, done && s.titleDone]} numberOfLines={2}>
        {task.title}
      </Text>
    </Pressable>
  );
}

const taskRowStyles = (c: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 11,
      paddingHorizontal: 16,
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      backgroundColor: c.card,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: c.mutedForeground,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    title: {
      flex: 1,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      color: c.foreground,
      lineHeight: 20,
    },
    titleDone: {
      textDecorationLine: 'line-through',
      color: c.mutedForeground,
    },
  });

// ─── Inline add task input ────────────────────────────────────────────────────

function AddTaskRow({
  onAdd,
  onCancel,
}: {
  onAdd: (title: string) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed) onAdd(trimmed);
    else onCancel();
  };

  return (
    <View style={[addStyles.row, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
      <View style={[addStyles.checkbox, { borderColor: colors.mutedForeground }]} />
      <TextInput
        ref={inputRef}
        style={[addStyles.input, { color: colors.foreground }]}
        value={text}
        onChangeText={setText}
        placeholder="New task…"
        placeholderTextColor={colors.mutedForeground}
        returnKeyType="done"
        onSubmitEditing={submit}
        onBlur={onCancel}
        autoCorrect={false}
      />
      <Pressable onPress={submit} hitSlop={8}>
        <Feather name="arrow-up-circle" size={22} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const addStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
    paddingVertical: 2,
  },
});

// ─── Task list section ────────────────────────────────────────────────────────

function ListSection({
  list,
  onToggle,
  onAddTask,
  isOnline,
}: {
  list: TaskList;
  onToggle: (taskId: number, done: boolean) => void;
  onAddTask: (listId: number, title: string) => void;
  isOnline: boolean;
}) {
  const colors = useColors();
  const [showAdd, setShowAdd] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const active = list.tasks.filter((t) => t.completedAt === null);
  const done = list.tasks.filter((t) => t.completedAt !== null);

  return (
    <View style={{ marginBottom: 20 }}>
      {/* Section header */}
      <View style={[sectionStyles.header, { borderBottomColor: colors.border }]}>
        <Text style={[sectionStyles.name, { color: colors.foreground }]}>{list.name}</Text>
        <Text style={[sectionStyles.count, { color: colors.mutedForeground }]}>
          {active.length} active
        </Text>
        {isOnline && (
          <Pressable
            onPress={() => { setShowAdd(true); }}
            hitSlop={8}
            style={sectionStyles.addBtn}
          >
            <Feather name="plus" size={18} color={colors.primary} />
          </Pressable>
        )}
      </View>

      {/* Active tasks */}
      {active.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          onToggle={() => onToggle(task.id, false)}
        />
      ))}

      {/* Inline add row */}
      {showAdd && (
        <AddTaskRow
          onAdd={(title) => { onAddTask(list.id, title); setShowAdd(false); }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Completed section */}
      {done.length > 0 && (
        <Pressable
          style={[sectionStyles.doneToggle, { borderBottomColor: colors.border }]}
          onPress={() => setShowDone((v) => !v)}
        >
          <Feather
            name={showDone ? 'chevron-down' : 'chevron-right'}
            size={14}
            color={colors.mutedForeground}
          />
          <Text style={[sectionStyles.doneLabel, { color: colors.mutedForeground }]}>
            {done.length} completed
          </Text>
        </Pressable>
      )}
      {showDone &&
        done.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onToggle={() => onToggle(task.id, true)}
          />
        ))}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  name: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    fontWeight: '600' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  count: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  addBtn: { padding: 2 },
  doneToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  doneLabel: { fontSize: 13, fontFamily: 'Inter_400Regular' },
});

// ─── Create list modal ────────────────────────────────────────────────────────

function CreateListRow({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [name, setName] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, []);

  const submit = () => {
    const n = name.trim();
    if (n) onCreate(n);
    else onCancel();
  };

  return (
    <View style={[createListStyles.row, { backgroundColor: colors.muted, borderColor: colors.border }]}>
      <TextInput
        ref={inputRef}
        style={[createListStyles.input, { color: colors.foreground }]}
        value={name}
        onChangeText={setName}
        placeholder="List name…"
        placeholderTextColor={colors.mutedForeground}
        returnKeyType="done"
        onSubmitEditing={submit}
        onBlur={onCancel}
      />
      <Pressable onPress={submit} hitSlop={8}>
        <Feather name="arrow-up-circle" size={22} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const createListStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TasksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isOnline, apiFetch } = useApp();

  const [lists, setLists] = useState<TaskList[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateList, setShowCreateList] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    setError(null);
    try {
      const res = await apiFetch('/tasks/lists');
      if (res.status === 403) { setError('Tasks feature is disabled on this server.'); return; }
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json() as TaskList[];
      setLists(data);
    } catch {
      setError('Could not load tasks.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOnline, apiFetch]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchTasks(); }, [fetchTasks]);

  // Toggle task completion (optimistic)
  const handleToggle = useCallback(async (taskId: number, wasDone: boolean) => {
    // Optimistic update
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        tasks: list.tasks.map((t) =>
          t.id === taskId
            ? { ...t, completedAt: wasDone ? null : new Date().toISOString() }
            : t,
        ),
      })),
    );
    try {
      await apiFetch(`/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !wasDone }),
      });
    } catch {
      // Revert on failure
      setLists((prev) =>
        prev.map((list) => ({
          ...list,
          tasks: list.tasks.map((t) =>
            t.id === taskId
              ? { ...t, completedAt: wasDone ? new Date().toISOString() : null }
              : t,
          ),
        })),
      );
    }
  }, [apiFetch]);

  // Add task to a list (optimistic)
  const handleAddTask = useCallback(async (listId: number, title: string) => {
    Keyboard.dismiss();
    const tempId = -Date.now();
    const tempTask: Task = { id: tempId, title, completedAt: null, position: 9999, createdAt: new Date().toISOString() };
    setLists((prev) =>
      prev.map((list) =>
        list.id === listId ? { ...list, tasks: [...list.tasks, tempTask] } : list,
      ),
    );
    try {
      const res = await apiFetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({ listId, title }),
      });
      if (res.ok) {
        const created = await res.json() as Task;
        setLists((prev) =>
          prev.map((list) =>
            list.id === listId
              ? { ...list, tasks: list.tasks.map((t) => (t.id === tempId ? created : t)) }
              : list,
          ),
        );
      }
    } catch {
      // Remove temp task on failure
      setLists((prev) =>
        prev.map((list) =>
          list.id === listId ? { ...list, tasks: list.tasks.filter((t) => t.id !== tempId) } : list,
        ),
      );
    }
  }, [apiFetch]);

  // Create new list
  const handleCreateList = useCallback(async (name: string) => {
    setShowCreateList(false);
    Keyboard.dismiss();
    try {
      const res = await apiFetch('/tasks/lists', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const newList = await res.json() as { id: number; name: string };
        setLists((prev) => [...prev, { ...newList, tasks: [] }]);
      }
    } catch { /* ignore */ }
  }, [apiFetch]);

  const s = screenStyles(colors, insets);

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerTop}>
          <Feather name="check-square" size={20} color={colors.primary} />
          <Text style={s.headerTitle}>Tasks</Text>
          <View style={{ flex: 1 }} />
          {!isOnline && (
            <View style={s.offlineBadge}>
              <Feather name="wifi-off" size={11} color={colors.mutedForeground} />
              <Text style={s.offlineText}> Offline</Text>
            </View>
          )}
          {isOnline && (
            <Pressable
              onPress={() => setShowCreateList((v) => !v)}
              hitSlop={8}
              style={s.newListBtn}
            >
              <Feather name="plus" size={20} color={colors.primary} />
              <Text style={[s.newListText, { color: colors.primary }]}>New List</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Body */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Feather name="alert-circle" size={36} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>Unavailable</Text>
          <Text style={s.emptySub}>{error}</Text>
        </View>
      ) : !isOnline && lists.length === 0 ? (
        <View style={s.center}>
          <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>You're offline</Text>
          <Text style={s.emptySub}>Connect to your Memex server to view tasks.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.scroll, lists.length === 0 && s.scrollEmpty]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          keyboardShouldPersistTaps="handled"
        >
          {/* New list input */}
          {showCreateList && (
            <CreateListRow
              onCreate={handleCreateList}
              onCancel={() => setShowCreateList(false)}
            />
          )}

          {lists.length === 0 && !showCreateList ? (
            <View style={s.center}>
              <Feather name="check-square" size={40} color={colors.mutedForeground} />
              <Text style={s.emptyTitle}>No task lists</Text>
              <Text style={s.emptySub}>
                Tap "+ New List" to create your first task list.
              </Text>
            </View>
          ) : (
            lists.map((list) => (
              <ListSection
                key={list.id}
                list={list}
                onToggle={handleToggle}
                onAddTask={handleAddTask}
                isOnline={isOnline}
              />
            ))
          )}
        </ScrollView>
      )}

      <BottomTabBar active="tasks" />
    </View>
  );
}

const screenStyles = (c: ReturnType<typeof useColors>, insets: ReturnType<typeof useSafeAreaInsets>) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    header: {
      backgroundColor: c.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) + 12,
      paddingBottom: 14,
      paddingHorizontal: 16,
    },
    headerTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerTitle: {
      fontSize: 20,
      fontWeight: '700' as const,
      fontFamily: 'Inter_700Bold',
      color: c.foreground,
    },
    offlineBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.muted,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 20,
    },
    offlineText: { fontSize: 11, color: c.mutedForeground, fontFamily: 'Inter_500Medium' },
    newListBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    newListText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 10,
      paddingVertical: 60,
    },
    scroll: { paddingTop: 12, paddingBottom: 20 },
    scrollEmpty: { flex: 1 },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '600' as const,
      fontFamily: 'Inter_600SemiBold',
      color: c.foreground,
    },
    emptySub: {
      fontSize: 14,
      color: c.mutedForeground,
      fontFamily: 'Inter_400Regular',
      textAlign: 'center',
      lineHeight: 20,
    },
  });
