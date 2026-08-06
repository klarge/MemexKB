import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useApp, type CachedArticle } from '@/context/AppContext';
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import RenderHtml from 'react-native-render-html';

export default function ArticleDetail() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { getArticle, serverUrl, isOnline } = useApp();

  const [article, setArticle] = useState<CachedArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    getArticle(slug)
      .then((a) => {
        if (!a) setError('Article not found.');
        else setArticle(a);
      })
      .catch(() => setError('Failed to load article.'))
      .finally(() => setLoading(false));
  }, [slug]);

  const s = styles(colors, insets, width);

  const tagsStyles = {
    h1: { fontSize: 22, fontWeight: '700' as const, color: colors.foreground, marginBottom: 8, marginTop: 16 },
    h2: { fontSize: 19, fontWeight: '700' as const, color: colors.foreground, marginBottom: 6, marginTop: 14 },
    h3: { fontSize: 17, fontWeight: '600' as const, color: colors.foreground, marginBottom: 4, marginTop: 12 },
    p: { fontSize: 15, color: colors.foreground, lineHeight: 24, marginBottom: 10 },
    a: { color: colors.primary, textDecorationLine: 'underline' as const },
    strong: { fontWeight: '700' as const },
    em: { fontStyle: 'italic' as const },
    code: { backgroundColor: colors.muted, color: colors.foreground, fontSize: 13, borderRadius: 3, paddingHorizontal: 4 },
    pre: { backgroundColor: colors.muted, borderRadius: 6, padding: 12 },
    blockquote: { borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 12, opacity: 0.85 },
    li: { fontSize: 15, color: colors.foreground, lineHeight: 22, marginBottom: 4 },
    table: { borderWidth: 1, borderColor: colors.border, borderRadius: 4 },
    th: { backgroundColor: colors.muted, fontWeight: '600' as const, color: colors.foreground, padding: 8, borderWidth: 1, borderColor: colors.border },
    td: { color: colors.foreground, padding: 8, borderWidth: 1, borderColor: colors.border },
  };

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
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
      ) : error ? (
        <View style={s.center}>
          <Feather name="alert-circle" size={36} color={colors.mutedForeground} />
          <Text style={s.errorText}>{error}</Text>
          <Pressable style={s.retryBtn} onPress={() => router.back()}>
            <Text style={s.retryBtnText}>Go back</Text>
          </Pressable>
        </View>
      ) : article ? (
        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Title */}
          <Text style={s.title}>{article.title}</Text>

          {/* Meta */}
          <View style={s.metaRow}>
            <Text style={s.metaText}>
              Updated {format(new Date(article.updatedAt), "MMM d, yyyy")}
            </Text>
            {article.updatedByName ? (
              <Text style={s.metaText}> · {article.updatedByName}</Text>
            ) : null}
          </View>

          {/* Tags */}
          {article.tags.length > 0 && (
            <View style={s.tagsRow}>
              {article.tags.map((tag) => (
                <View
                  key={tag.id}
                  style={[s.tag, { backgroundColor: tag.color + '22', borderColor: tag.color + '66' }]}
                >
                  <Text style={[s.tagText, { color: tag.color }]}>{tag.name}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Restricted notice */}
          {article.isRestricted && !article.canAccess && (
            <View style={s.restrictedBox}>
              <Feather name="lock" size={16} color={colors.mutedForeground} />
              <Text style={s.restrictedText}>
                {'  '}This article is restricted. You don't have the required group access.
              </Text>
            </View>
          )}

          {/* Content */}
          {article.canAccess && article.content ? (
            <View style={s.contentWrap}>
              <RenderHtml
                contentWidth={width - 32}
                source={{ html: article.content, baseUrl: serverUrl ?? '' }}
                tagsStyles={tagsStyles}
                defaultTextProps={{ selectable: true }}
                enableExperimentalMarginCollapsing
              />
            </View>
          ) : article.canAccess && !article.content ? (
            <View style={s.center}>
              <Feather name="file-text" size={32} color={colors.mutedForeground} />
              <Text style={s.emptyContent}>
                {isOnline ? 'Empty article.' : 'Not cached yet. Connect to load this article.'}
              </Text>
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
  width: number,
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
    offlineBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.muted,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 20,
    },
    offlineText: { fontSize: 11, color: c.mutedForeground, fontFamily: 'Inter_500Medium' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
    errorText: { fontSize: 16, color: c.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center' },
    retryBtn: {
      marginTop: 8,
      paddingHorizontal: 20,
      paddingVertical: 10,
      backgroundColor: c.primary,
      borderRadius: c.radius,
    },
    retryBtnText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: insets.bottom + 40,
    },
    title: {
      fontSize: 26,
      fontWeight: '700' as const,
      fontFamily: 'Inter_700Bold',
      color: c.foreground,
      lineHeight: 34,
      marginBottom: 8,
    },
    metaRow: { flexDirection: 'row', marginBottom: 12 },
    metaText: { fontSize: 13, color: c.mutedForeground, fontFamily: 'Inter_400Regular' },
    tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
    tag: {
      borderRadius: 20,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    tagText: { fontSize: 12, fontFamily: 'Inter_500Medium', fontWeight: '500' as const },
    restrictedBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: c.muted,
      borderRadius: c.radius,
      padding: 14,
      marginBottom: 16,
    },
    restrictedText: {
      fontSize: 14,
      color: c.mutedForeground,
      fontFamily: 'Inter_400Regular',
      lineHeight: 20,
      flex: 1,
    },
    contentWrap: { marginTop: 4 },
    emptyContent: { fontSize: 14, color: c.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  });
