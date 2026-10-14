import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { saveLabel, saveState } from '@/components/offlineStatus';
import { confirmLocalRemoval } from '@/components/confirmLocalRemoval';
import { contentKind, contentKindLabel } from '@/offline/content';

type KindFilter = 'all' | 'knowledge' | 'policy' | 'procedure';
const KIND_FILTERS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'All content' }, { key: 'knowledge', label: 'Knowledge' },
  { key: 'policy', label: 'Policies' }, { key: 'procedure', label: 'Procedures' },
];
const KIND_ICON = { knowledge: 'file-text', policy: 'shield', procedure: 'list' } as const;

// ─── Article card ─────────────────────────────────────────────────────────────

function ArticleCard({ article, onPress, onDownload, onRemove, canDownload, busy }: {
  article: CachedArticle; onPress: () => void; onDownload: () => void; onRemove: () => void; canDownload: boolean; busy: boolean;
}) {
  const colors = useColors();
  const s = cardStyles(colors);
  const state = saveState(article);
  return (
    <View style={s.cardWrap}>
    <Pressable style={({ pressed }) => [s.card, pressed && { opacity: 0.75 }]} onPress={onPress}
      accessibilityRole="button" accessibilityLabel={`${contentKindLabel(article)}: ${article.title}. ${saveLabel(article)}`} testID={`article-${article.slug}`}>
      <View style={s.iconBox}>
        {article.isRestricted
          ? <Feather name="lock" size={16} color={colors.primary} />
          : <Feather name={KIND_ICON[contentKind(article)]} size={16} color={colors.primary} />}
      </View>
      <View style={s.content}>
        <Text style={s.title} numberOfLines={2}>{article.title}</Text>
        <View style={s.meta}>
          <Text style={[s.metaText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>{contentKindLabel(article)} · </Text>
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
    <View style={s.statusRow}>
      <Text style={[s.statusText, state === 'saved' && { color: colors.primary }]} numberOfLines={2}>{saveLabel(article)}</Text>
      {state !== 'saved' && (
        <Pressable style={[s.smallBtn, (!canDownload || busy) && { opacity: 0.5 }]} onPress={onDownload} disabled={!canDownload || busy}
          accessibilityRole="button" accessibilityLabel={`${state === 'none' ? 'Download' : state === 'stale' ? 'Update' : 'Retry download of'} ${article.title}`}
          testID={`download-${article.slug}`}>
          <Text style={s.smallBtnText}>{state === 'none' ? 'Download' : state === 'stale' ? 'Update' : 'Retry'}</Text>
        </Pressable>
      )}
      {state !== 'none' && (
        <Pressable style={s.smallBtnGhost} onPress={onRemove} accessibilityRole="button"
          accessibilityLabel={`Remove local download of ${article.title}`} testID={`remove-${article.slug}`}>
          <Text style={s.smallBtnGhostText}>Remove</Text>
        </Pressable>
      )}
    </View>
    </View>
  );
}

const cardStyles = (c: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    cardWrap: { backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 10, paddingLeft: 64 },
    statusText: { flex: 1, fontSize: 11, color: c.mutedForeground, fontFamily: 'Inter_400Regular' },
    smallBtn: { backgroundColor: c.primary, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
    smallBtnText: { color: '#fff', fontSize: 12, fontFamily: 'Inter_600SemiBold' },
    smallBtnGhost: { backgroundColor: c.muted, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
    smallBtnGhostText: { color: c.foreground, fontSize: 12, fontFamily: 'Inter_600SemiBold' },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
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
    meta: { flexDirection: 'row', flexWrap: 'wrap' },
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
    user, sessionCookie, serverUrl, logout, cachedArticles, cachedTags, isOnline, isSyncing, syncProgress,
    syncArticles, lastSyncedAt, downloadAllArticles, downloadArticle, removeDownload, clearDownloads, downloadError, isHydrating,
  } = useApp();
  const [filter, setFilter] = useState<'all' | 'downloaded'>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const initiallySyncedIdentityRef = useRef<string | null>(null);

  // Every authenticated identity gets an authoritative online sync, even when
  // its persisted cache is non-empty, so revoked access is pruned promptly.
  useEffect(() => {
    if (!isOnline) { initiallySyncedIdentityRef.current = null; return; }
    const identity = user && sessionCookie ? `${serverUrl}:${user.id}:${sessionCookie}` : null;
    if (isOnline && identity && initiallySyncedIdentityRef.current !== identity) {
      initiallySyncedIdentityRef.current = identity;
      syncArticles();
    }
  }, [isOnline, user, sessionCookie, serverUrl, syncArticles]);

  const filtered = useMemo(() => {
    let list = [...cachedArticles];
    if (filter === 'downloaded') list = list.filter((a) => a.contentCached);
    if (kindFilter !== 'all') list = list.filter((a) => contentKind(a) === kindFilter);
    if (selectedTagId !== null) {
      list = list.filter((a) => a.tags.some((t) => t.id === selectedTagId));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => a.searchText.includes(q) || a.title.toLowerCase().includes(q));
    }
    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [cachedArticles, search, selectedTagId, filter, kindFilter]);

  const downloadedCount = cachedArticles.filter((a) => a.contentCached).length;
  const partialCount = cachedArticles.filter((a) => ['partial', 'stale'].includes(saveState(a))).length;
  const runDownload = async (slug: string) => {
    setBusySlug(slug); setActionError(null);
    try { await downloadArticle(slug); } catch (e) { setActionError(e instanceof Error ? e.message : 'Download failed.'); }
    finally { setBusySlug(null); }
  };
  const confirmRemove = (a: CachedArticle) => confirmLocalRemoval('Remove download', `Delete the saved copy of "${a.title}" from this device?`,
    () => removeDownload(a.slug), setActionError);
  const confirmClear = () => confirmLocalRemoval('Clear all downloads', 'Delete every saved document and image on this device? The article list stays; you can download again while online.',
    clearDownloads, setActionError);

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
        onDownload={() => { void runDownload(item.slug); }}
        onRemove={() => confirmRemove(item)}
        canDownload={isOnline}
        busy={busySlug === item.slug || isSyncing}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, isOnline, busySlug, isSyncing, downloadArticle, removeDownload],
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
          <Pressable onPress={handleLogout} style={s.logoutBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Sign out" testID="sign-out">
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

        <Text style={s.lastSync} testID="download-summary">
          {downloadedCount} of {cachedArticles.length} saved offline{partialCount ? ` · ${partialCount} partial or out of date` : ''}
          {!isOnline ? ' · Offline: only saved documents open. Offline access lasts up to 7 days after sign-in and ends on sign-out or server change; revoked access is only detected when you reconnect.' : ''}
        </Text>
        <Text style={s.lastSync}>External sites, external images and interactive editors are unavailable in the reader.</Text>
        {(downloadError || actionError) ? (
          <Text style={[s.syncText, { color: colors.destructive }]} accessibilityLiveRegion="polite" testID="download-error">{downloadError ?? actionError}</Text>
        ) : null}
        <View style={s.actionRow}>
          <Pressable style={[s.pill, (!isOnline || isSyncing) && { opacity: 0.5 }]} disabled={!isOnline || isSyncing} onPress={() => { void syncArticles(); }}
            accessibilityRole="button" accessibilityLabel="Refresh saved articles" testID="refresh-saved-button">
            <Feather name="refresh-cw" size={13} color={colors.foreground} /><Text style={s.pillText}>Refresh saved</Text>
          </Pressable>
          <Pressable style={[s.pill, s.pillPrimary, (!isOnline || isSyncing) && { opacity: 0.5 }]} disabled={!isOnline || isSyncing} onPress={() => { void downloadAllArticles(); }}
            accessibilityRole="button" accessibilityLabel="Download all articles" testID="download-all-button">
            <Feather name="download" size={13} color="#fff" /><Text style={[s.pillText, { color: '#fff' }]}>Download all</Text>
          </Pressable>
          <Pressable style={[s.pill, downloadedCount === 0 && { opacity: 0.5 }]} disabled={downloadedCount === 0 || isSyncing} onPress={confirmClear}
            accessibilityRole="button" accessibilityLabel="Clear downloads" testID="clear-downloads-button">
            <Feather name="trash-2" size={13} color={colors.foreground} /><Text style={s.pillText}>Clear</Text>
          </Pressable>
        </View>
        <View style={s.actionRow}>
          {(['all', 'downloaded'] as const).map((f) => (
            <Pressable key={f} style={[s.pill, filter === f && s.pillPrimary]} onPress={() => setFilter(f)}
              accessibilityRole="button" accessibilityState={{ selected: filter === f }} accessibilityLabel={f === 'all' ? 'Show all documents' : 'Show downloaded documents'}
              testID={`filter-${f}`}>
              <Text style={[s.pillText, filter === f && { color: '#fff' }]}>{f === 'all' ? 'All' : 'Downloaded'}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tagFilterRow}>
          {KIND_FILTERS.map(({ key, label }) => (
            <Pressable key={key} style={[s.pill, kindFilter === key && s.pillPrimary]} onPress={() => setKindFilter(key)}
              accessibilityRole="button" accessibilityState={{ selected: kindFilter === key }}
              accessibilityLabel={`Show ${label.toLowerCase()}`} testID={`kind-${key}`}>
              <Text style={[s.pillText, kindFilter === key && { color: '#fff' }]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Search */}
        <View style={s.searchRow}>
          <Feather name="search" size={15} color={colors.mutedForeground} style={s.searchIcon} />
          <TextInput
            testID="article-search"
            accessibilityLabel="Search saved documents"
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search documents…"
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
      {isHydrating ? (
        <View style={s.empty}><ActivityIndicator color={colors.primary} /><Text style={s.emptySub}>Loading saved documents…</Text></View>
      ) : cachedArticles.length === 0 && !isSyncing ? (
        <View style={s.empty}>
          <Feather name="book-open" size={40} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>No documents</Text>
          <Text style={s.emptySub}>
            {isOnline
              ? 'Sync your Memex instance to list documents.'
              : 'Connect to your Memex server to sync documents.'}
          </Text>
          {isOnline && (
            <Pressable style={s.emptyBtn} onPress={() => { void syncArticles(); }} accessibilityRole="button" testID="empty-sync-button">
              <Text style={s.emptyBtnText}>Sync documents</Text>
            </Pressable>
          )}
        </View>
      ) : filtered.length === 0 && !isSyncing ? (
        <View style={s.empty}>
          <Feather name="search" size={36} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>No results</Text>
          <Text style={s.emptySub}>
            {filter === 'downloaded' ? 'No downloaded documents match. Download documents to read them offline.' : 'Try a different search, tag or content type.'}
          </Text>
          <Pressable style={s.emptyBtn} testID="empty-reset-button" accessibilityRole="button"
            onPress={() => { setSearch(''); setSelectedTagId(null); setFilter('all'); setKindFilter('all'); }}>
            <Text style={s.emptyBtnText}>Reset filters</Text>
          </Pressable>
          {filter === 'downloaded' && isOnline && (
            <Pressable style={s.emptyBtn} testID="empty-download-all" accessibilityRole="button" onPress={() => { void downloadAllArticles(); }}>
              <Text style={s.emptyBtnText}>Download all</Text>
            </Pressable>
          )}
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
    actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.muted, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
    pillPrimary: { backgroundColor: c.primary },
    pillText: { fontSize: 12, color: c.foreground, fontFamily: 'Inter_600SemiBold' },
    emptyBtn: { marginTop: 6, backgroundColor: c.primary, borderRadius: c.radius, paddingHorizontal: 18, paddingVertical: 10 },
    emptyBtnText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
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
