import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useApp, type CachedArticle } from '@/context/AppContext';
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import { BottomTabBar } from '@/components/BottomTabBar';

// ─── Article card ─────────────────────────────────────────────────────────────

function ArticleCard({ article, onPress }: { article: CachedArticle; onPress: () => void }) {
  const colors = useColors();
  const s = cardStyles(colors);
  return (
    <Pressable style={({ pressed }) => [s.card, pressed && { opacity: 0.75 }]} onPress={onPress}>
      <View style={s.iconBox}>
        {article.isRestricted
          ? <Feather name="lock" size={16} color={colors.primary} />
          : <Feather name="file-text" size={16} color={colors.primary} />}
      </View>
      <View style={s.content}>
        <Text style={s.title} numberOfLines={2}>{article.title}</Text>
        <View style={s.meta}>
          <Text style={s.metaText}>
            {format(new Date(article.updatedAt), 'MMM d, yyyy')}
          </Text>
          {article.updatedByName ? (
            <Text style={s.metaText}> · {article.updatedByName}</Text>
          ) : null}
        </View>
        {article.tags.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tagScroll}>
            {article.tags.map((tag) => (
              <View key={tag.id} style={[s.tag, { backgroundColor: tag.color + '22', borderColor: tag.color + '55' }]}>
                <Text style={[s.tagText, { color: tag.color }]}>{tag.name}</Text>
              </View>
            ))}
          </ScrollView>
        )}
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
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      gap: 12,
    },
    iconBox: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: c.primary + '15',
      alignItems: 'center',
      justifyContent: 'center',
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
    meta: { flexDirection: 'row' },
    metaText: { fontSize: 12, color: c.mutedForeground, fontFamily: 'Inter_400Regular' },
    tagScroll: { marginTop: 4 },
    tag: {
      borderRadius: 20,
      borderWidth: 1,
      paddingHorizontal: 8,
      paddingVertical: 2,
      marginRight: 6,
    },
    tagText: { fontSize: 11, fontFamily: 'Inter_500Medium', fontWeight: '500' as const },
  });

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ArticleList() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    user, logout, cachedArticles, cachedTags, isOnline, isSyncing, syncProgress,
    syncArticles, lastSyncedAt,
  } = useApp();

  const [search, setSearch] = useState('');
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);

  // Initial sync on mount when online
  useEffect(() => {
    if (isOnline && cachedArticles.length === 0) {
      syncArticles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let list = cachedArticles;
    if (selectedTagId !== null) {
      list = list.filter((a) => a.tags.some((t) => t.id === selectedTagId));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => a.searchText.includes(q) || a.title.toLowerCase().includes(q));
    }
    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [cachedArticles, search, selectedTagId]);

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const s = styles(colors, insets);

  const syncLabel = useMemo(() => {
    if (!isSyncing) return null;
    if (syncProgress?.phase === 'summaries') return 'Loading articles…';
    if (syncProgress?.phase === 'content' && (syncProgress.total ?? 0) > 0) {
      return `Caching ${syncProgress.current}/${syncProgress.total}`;
    }
    return 'Syncing…';
  }, [isSyncing, syncProgress]);

  const renderItem = useCallback(
    ({ item }: { item: CachedArticle }) => (
      <ArticleCard
        article={item}
        onPress={() => router.push(`/(tabs)/article/${item.slug}`)}
      />
    ),
    [router],
  );

  const keyExtractor = useCallback((item: CachedArticle) => item.slug, []);

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerTop}>
          <View style={s.logoMini}>
            <Text style={s.logoMiniText}>M</Text>
          </View>
          <Text style={s.headerTitle}>Memex</Text>
          <View style={{ flex: 1 }} />
          {!isOnline && (
            <View style={s.offlineBadge}>
              <Feather name="wifi-off" size={11} color={colors.mutedForeground} />
              <Text style={s.offlineText}> Offline</Text>
            </View>
          )}
          <Pressable onPress={handleLogout} style={s.logoutBtn} hitSlop={8}>
            <Feather name="log-out" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Sync status */}
        {syncLabel ? (
          <View style={s.syncRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={s.syncText}> {syncLabel}</Text>
          </View>
        ) : lastSyncedAt && (
          <Text style={s.lastSync}>
            Synced {format(lastSyncedAt, "MMM d 'at' h:mm a")}
          </Text>
        )}

        {/* Search */}
        <View style={s.searchRow}>
          <Feather name="search" size={15} color={colors.mutedForeground} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search articles…"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
        </View>

        {/* Tag filter chips */}
        {cachedTags.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.tagFilterRow}
          >
            {cachedTags.map((tag) => {
              const active = selectedTagId === tag.id;
              return (
                <Pressable
                  key={tag.id}
                  style={[
                    s.tagChip,
                    active
                      ? { backgroundColor: tag.color, borderColor: tag.color }
                      : { backgroundColor: 'transparent', borderColor: tag.color + '88' },
                  ]}
                  onPress={() => setSelectedTagId(active ? null : tag.id)}
                >
                  <Text
                    style={[s.tagChipText, { color: active ? '#fff' : tag.color }]}
                  >
                    {tag.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* Article list / empty states */}
      {cachedArticles.length === 0 && !isSyncing ? (
        <View style={s.empty}>
          <Feather name="book-open" size={40} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>No articles</Text>
          <Text style={s.emptySub}>
            {isOnline
              ? 'Pull down to sync your Memex instance.'
              : 'Connect to your Memex server to sync articles.'}
          </Text>
        </View>
      ) : filtered.length === 0 && !isSyncing ? (
        <View style={s.empty}>
          <Feather name="search" size={36} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>No results</Text>
          <Text style={s.emptySub}>Try a different search or tag.</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          scrollEnabled={!!filtered.length}
          contentContainerStyle={{ paddingBottom: 20 }}
          refreshControl={
            <RefreshControl
              refreshing={isSyncing}
              onRefresh={syncArticles}
              tintColor={colors.primary}
            />
          }
        />
      )}

      <BottomTabBar active="articles" />
    </View>
  );
}

const styles = (c: ReturnType<typeof useColors>, insets: ReturnType<typeof useSafeAreaInsets>) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    header: {
      backgroundColor: c.card,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) + 12,
      paddingBottom: 10,
      paddingHorizontal: 16,
      gap: 10,
    },
    headerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    logoMini: {
      width: 28,
      height: 28,
      borderRadius: 7,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoMiniText: { fontSize: 16, fontWeight: '700' as const, color: '#fff', fontFamily: 'Inter_700Bold' },
    headerTitle: { fontSize: 17, fontWeight: '700' as const, fontFamily: 'Inter_700Bold', color: c.foreground },
    offlineBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.muted,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 20,
    },
    offlineText: { fontSize: 11, color: c.mutedForeground, fontFamily: 'Inter_500Medium' },
    logoutBtn: { padding: 4 },
    syncRow: { flexDirection: 'row', alignItems: 'center' },
    syncText: { fontSize: 12, color: c.mutedForeground, fontFamily: 'Inter_400Regular' },
    lastSync: { fontSize: 11, color: c.mutedForeground, fontFamily: 'Inter_400Regular' },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.muted,
      borderRadius: c.radius,
      paddingHorizontal: 10,
      height: 40,
    },
    searchIcon: { marginRight: 6 },
    searchInput: {
      flex: 1,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      color: c.foreground,
      height: '100%',
    },
    tagFilterRow: { paddingRight: 4, gap: 6, flexDirection: 'row' },
    tagChip: {
      borderWidth: 1,
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    tagChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', fontWeight: '500' as const },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 10,
    },
    emptyTitle: { fontSize: 17, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold', color: c.foreground },
    emptySub: { fontSize: 14, color: c.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  });
