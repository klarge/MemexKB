import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useApp, type CachedArticle } from '@/context/AppContext';
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import { OfflineReader } from '@/components/OfflineReader';
import { saveLabel, saveState } from '@/components/offlineStatus';
import { confirmLocalRemoval } from '@/components/confirmLocalRemoval';

export default function ArticleDetail() {
  const { slug, fragment } = useLocalSearchParams<{ slug: string; fragment?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);
  const { getArticle, downloadArticle, removeDownload, serverUrl, isOnline, user, sessionCookie, cachedArticles } = useApp();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const identity = user && sessionCookie ? `${serverUrl}:${user.id}:${sessionCookie}` : null;

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    if (!slug || !identity) {
      setError('Article not found.');
      setLoading(false);
      return;
    }
    getArticle(slug)
      .then((a) => {
        if (request !== requestRef.current) return;
        if (!a) setError(isOnline ? 'Article not found.' : 'This article is not saved on this device.');
        else setError(null);
      })
      .catch(() => {
        if (request === requestRef.current) setError('Failed to load article.');
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  // getArticle is omitted deliberately; identity is the security boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, identity]);

  useEffect(() => { load(); }, [load]);

  // Live library entry reflects downloads/removals made while this screen is open.
  const live = identity ? cachedArticles.find((a) => a.slug === slug) : undefined;
  const view: CachedArticle | null = live && live.contentCached && live.canAccess !== false ? live : null;
  const summary = live;

  const download = async () => {
    if (!slug) return;
    setBusy(true);
    setNotice(null);
    try {
      const a = await downloadArticle(slug);
      if (a) setError(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Download failed.');
    } finally { setBusy(false); }
  };
  const remove = () => {
    if (!slug) return;
    confirmLocalRemoval('Remove download', 'Delete the saved copy and images of this article from this device?',
      async () => {
        setBusy(true);
        try { await removeDownload(slug); } finally { setBusy(false); }
      }, setNotice);
  };

  const openArticle = useCallback((target: string, frag: string) => {
    router.push({ pathname: '/(tabs)/article/[slug]', params: frag ? { slug: target, fragment: frag } : { slug: target } });
  }, [router]);

  const s = styles(colors, insets);
  const state = summary ? saveState(summary) : 'none';
  const missing = !loading && !!summary && !view && summary.canAccess !== false;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={goBack} style={s.backBtn} hitSlop={8}
          accessibilityRole="button" accessibilityLabel="Go back" testID="reader-back">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {!isOnline && (
          <View style={s.offlineBadge}>
            <Feather name="wifi-off" size={11} color={colors.mutedForeground} />
            <Text style={s.offlineText}> Offline</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : !summary ? (
        <View style={s.center} testID="reader-missing">
          <Feather name="download-cloud" size={36} color={colors.mutedForeground} />
          <Text style={s.errorText}>{error ?? 'This article is no longer available.'}</Text>
          {isOnline && slug ? (
            <Pressable style={s.retryBtn} onPress={download} disabled={busy} accessibilityRole="button" testID="reader-retry">
              <Text style={s.retryBtnText}>{busy ? 'Downloading…' : 'Retry download'}</Text>
            </Pressable>
          ) : (
            <Text style={s.hint}>Connect to the internet to download it.</Text>
          )}
          <Pressable style={s.ghostBtn} onPress={goBack}><Text style={s.ghostText}>Go back</Text></Pressable>
        </View>
      ) : summary ? (
        <ScrollView ref={scrollRef} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={s.title}>{summary.title}</Text>
          <View style={s.metaRow}>
            <Text style={s.metaText}>
              Updated {format(new Date(summary.updatedAt), 'MMM d, yyyy')}
              {summary.updatedByName ? ` · ${summary.updatedByName}` : ''}
            </Text>
          </View>

          {summary.tags.length > 0 && (
            <View style={s.tagsRow}>
              {summary.tags.map((tag) => (
                <View key={tag.id} style={[s.tag, { backgroundColor: tag.color + '22', borderColor: tag.color + '66' }]}>
                  <Text style={[s.tagText, { color: tag.color }]}>{tag.name}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={s.statusBox} testID="reader-status" accessibilityLabel={`Offline status: ${saveLabel(summary)}`}>
            <Feather name={state === 'saved' ? 'check-circle' : state === 'none' ? 'cloud-off' : 'alert-triangle'}
              size={15} color={state === 'saved' ? colors.primary : colors.mutedForeground} />
            <Text style={s.statusText}>{saveLabel(summary)}
              {summary.downloadedAt ? ` · downloaded ${format(new Date(summary.downloadedAt), 'MMM d, h:mm a')}` : ''}
              {state === 'stale' && !isOnline ? '. Reconnect to update.' : ''}
            </Text>
          </View>
          <View style={s.actions}>
            {(state !== 'saved') && (
              <Pressable style={[s.actionBtn, { backgroundColor: colors.primary }, (!isOnline || busy) && { opacity: 0.5 }]}
                onPress={download} disabled={!isOnline || busy} accessibilityRole="button"
                accessibilityLabel={state === 'none' ? 'Download article' : 'Retry download'} testID="reader-download">
                <Feather name="download" size={14} color="#fff" />
                <Text style={s.actionTextLight}>{busy ? 'Working…' : state === 'none' ? 'Download' : state === 'stale' ? 'Update' : 'Retry'}</Text>
              </Pressable>
            )}
            {state !== 'none' && (
              <Pressable style={[s.actionBtn, { backgroundColor: colors.muted }, busy && { opacity: 0.5 }]}
                onPress={remove} disabled={busy} accessibilityRole="button"
                accessibilityLabel="Remove local download" testID="reader-remove">
                <Feather name="trash-2" size={14} color={colors.foreground} />
                <Text style={s.actionText}>Remove download</Text>
              </Pressable>
            )}
          </View>
          {notice ? <Text style={s.noticeText} accessibilityLiveRegion="polite" testID="reader-notice">{notice}</Text> : null}

          {summary.isRestricted && summary.canAccess === false && (
            <View style={s.restrictedBox}>
              <Feather name="lock" size={16} color={colors.mutedForeground} />
              <Text style={s.restrictedText}>This article is restricted. You don't have the required group access.</Text>
            </View>
          )}

          {missing ? (
            <View style={s.missing} testID="reader-missing">
              <Feather name="cloud-off" size={30} color={colors.mutedForeground} />
              <Text style={s.errorText}>Not downloaded</Text>
              <Text style={s.hint}>
                {isOnline ? 'This article has no saved copy on this device. Download it to read it offline.'
                  : 'This article is not available offline. Connect to download it.'}
              </Text>
            </View>
          ) : view && serverUrl ? (
            <View style={s.contentWrap}>
              <OfflineReader article={view} server={serverUrl} scrollRef={scrollRef}
                targetFragment={typeof fragment === 'string' ? fragment : undefined}
                onArticle={openArticle} onFragmentMissing={setNotice} />
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = (
  c: ReturnType<typeof useColors>,
  insets: ReturnType<typeof useSafeAreaInsets>,
) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0),
      paddingHorizontal: 16,
      paddingBottom: 10,
      backgroundColor: c.card,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      gap: 12,
    },
    backBtn: { padding: 4 },
    offlineBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.muted, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
    offlineText: { fontSize: 11, color: c.mutedForeground, fontFamily: 'Inter_500Medium' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
    missing: { alignItems: 'center', gap: 10, padding: 24 },
    errorText: { fontSize: 16, color: c.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center' },
    hint: { fontSize: 13, color: c.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 19 },
    retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: c.primary, borderRadius: c.radius },
    retryBtnText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
    ghostBtn: { paddingHorizontal: 20, paddingVertical: 8 },
    ghostText: { color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
    scrollContent: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: insets.bottom + 40 },
    title: { fontSize: 26, fontWeight: '700' as const, fontFamily: 'Inter_700Bold', color: c.foreground, lineHeight: 34, marginBottom: 8 },
    metaRow: { flexDirection: 'row', marginBottom: 12 },
    metaText: { fontSize: 13, color: c.mutedForeground, fontFamily: 'Inter_400Regular' },
    tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
    tag: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
    tagText: { fontSize: 12, fontFamily: 'Inter_500Medium', fontWeight: '500' as const },
    statusBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.muted, borderRadius: c.radius, padding: 10, marginBottom: 10 },
    statusText: { flex: 1, fontSize: 12, color: c.mutedForeground, fontFamily: 'Inter_400Regular', lineHeight: 17 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: c.radius },
    actionText: { fontSize: 13, color: c.foreground, fontFamily: 'Inter_600SemiBold' },
    actionTextLight: { fontSize: 13, color: '#fff', fontFamily: 'Inter_600SemiBold' },
    noticeText: { fontSize: 13, color: c.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 10 },
    restrictedBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.muted, borderRadius: c.radius, padding: 14, marginBottom: 16 },
    restrictedText: { fontSize: 14, color: c.mutedForeground, fontFamily: 'Inter_400Regular', lineHeight: 20, flex: 1 },
    contentWrap: { marginTop: 4 },
  });
