import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { format, formatDistanceToNow } from 'date-fns';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { BottomTabBar } from '@/components/BottomTabBar';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: number;
  slug: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Log entry card ───────────────────────────────────────────────────────────

function LogCard({ entry, onPress }: { entry: LogEntry; onPress: () => void }) {
  const colors = useColors();
  const s = cardStyles(colors);
  const date = new Date(entry.createdAt);

  return (
    <Pressable style={({ pressed }) => [s.card, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={s.dateBadge}>
        <Text style={s.dateMonth}>{format(date, 'MMM').toUpperCase()}</Text>
        <Text style={s.dateDay}>{format(date, 'd')}</Text>
      </View>
      <View style={s.divider} />
      <View style={s.content}>
        <Text style={s.title} numberOfLines={2}>{entry.title}</Text>
        <Text style={s.meta}>
          Updated {formatDistanceToNow(new Date(entry.updatedAt), { addSuffix: true })}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

const cardStyles = (c: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
      backgroundColor: c.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      gap: 12,
    },
    dateBadge: {
      width: 44,
      alignItems: 'center',
      flexShrink: 0,
    },
    dateMonth: {
      fontSize: 10,
      fontFamily: 'Inter_500Medium',
      color: c.mutedForeground,
      letterSpacing: 0.5,
    },
    dateDay: {
      fontSize: 24,
      fontFamily: 'Inter_700Bold',
      fontWeight: '700' as const,
      color: c.foreground,
      lineHeight: 28,
    },
    divider: {
      width: 1,
      height: 36,
      backgroundColor: c.border,
      flexShrink: 0,
    },
    content: { flex: 1, gap: 3 },
    title: {
      fontSize: 15,
      fontWeight: '600' as const,
      fontFamily: 'Inter_600SemiBold',
      color: c.foreground,
      lineHeight: 20,
    },
    meta: { fontSize: 12, color: c.mutedForeground, fontFamily: 'Inter_400Regular' },
  });

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LogScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isOnline, apiFetch } = useApp();

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLog = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    setError(null);
    try {
      const res = await apiFetch('/log?limit=50');
      if (res.status === 403) {
        setError('Log feature is disabled on this server.');
        return;
      }
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json() as { entries: LogEntry[] };
      setEntries(data.entries ?? []);
    } catch {
      setError('Could not load log entries.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOnline, apiFetch]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchLog();
  }, [fetchLog]);

  const s = styles(colors, insets);

  const renderItem = useCallback(
    ({ item }: { item: LogEntry }) => (
      <LogCard entry={item} onPress={() => router.push(`/(tabs)/article/${item.slug}`)} />
    ),
    [router],
  );

  const keyExtractor = useCallback((item: LogEntry) => String(item.id), []);

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerTop}>
          <Feather name="edit-3" size={20} color={colors.primary} />
          <Text style={s.headerTitle}>Logs</Text>
          <View style={{ flex: 1 }} />
          {!isOnline && (
            <View style={s.offlineBadge}>
              <Feather name="wifi-off" size={11} color={colors.mutedForeground} />
              <Text style={s.offlineText}> Offline</Text>
            </View>
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
      ) : !isOnline && entries.length === 0 ? (
        <View style={s.center}>
          <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>You're offline</Text>
          <Text style={s.emptySub}>Connect to your Memex server to view log entries.</Text>
        </View>
      ) : entries.length === 0 ? (
        <View style={s.center}>
          <Feather name="edit-3" size={40} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>No log entries</Text>
          <Text style={s.emptySub}>Log entries you create will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ paddingBottom: 16 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        />
      )}

      <BottomTabBar active="log" />
    </View>
  );
}

const styles = (c: ReturnType<typeof useColors>, insets: ReturnType<typeof useSafeAreaInsets>) =>
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
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 10,
    },
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
