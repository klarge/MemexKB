import React, { useCallback, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import RenderHtml, { HTMLElementModel, HTMLContentModel } from 'react-native-render-html';
import { parseDocument } from 'htmlparser2';
import serialize from 'dom-serializer';
import { Element, type AnyNode } from 'domhandler';
import { readerHtml, articleLink, canonicalServer } from '@/offline/content';
import { useColors } from '@/hooks/useColors';
import type { CachedArticle } from '@/context/AppContext';

type Colors = ReturnType<typeof useColors>;
const models = { table: HTMLElementModel.fromCustomModel({ tagName: 'table', contentModel: HTMLContentModel.block }) };

function find(nodes: AnyNode[], name: string, out: Element[] = []): Element[] {
  for (const n of nodes) {
    if (n instanceof Element) {
      if (n.name === name) out.push(n); // do not descend into nested tables' rows
      else find(n.children, name, out);
    }
  }
  return out;
}

function findIds(nodes: AnyNode[], index: number, map: Record<string, number>) {
  for (const n of nodes) {
    if (n instanceof Element) {
      if (n.attribs.id) map[n.attribs.id] = index;
      if (n.attribs.name) map[n.attribs.name] = index;
      findIds(n.children, index, map);
    }
  }
}

function makeTable(colors: Colors, tagsStyles: Record<string, any>, renderersProps: Record<string, any>, baseUrl: string) {
  return function NativeTable(props: any) {
    const dom = props.tnode?.domNode as Element | undefined;
    if (!dom) return null;
    // RenderHtml uses an older domhandler instance. Reparse the structural
    // DOM rather than testing its nodes against our Element constructor.
    const parsed = parseDocument(serialize(dom));
    const table = find(parsed.children, 'table')[0];
    const rows = table ? find(table.children, 'tr') : [];
    const cols = Math.max(1, ...rows.map(r => r.children.filter(c => c instanceof Element && (c.name === 'td' || c.name === 'th')).length));
    const cellWidth = 150;
    return (
      <ScrollView horizontal accessibilityLabel="Table, scroll horizontally" testID="reader-table"
        style={{ marginVertical: 10 }} showsHorizontalScrollIndicator>
        <View style={{ borderWidth: 1, borderColor: colors.border, width: cols * cellWidth }}>
          {rows.map((row, i) => (
            <View key={i} style={{ flexDirection: 'row' }}>
              {row.children.filter((c): c is Element => c instanceof Element && (c.name === 'td' || c.name === 'th')).map((cell, j) => (
                <View key={j} style={{ width: cellWidth, padding: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
                  backgroundColor: cell.name === 'th' ? colors.muted : 'transparent' }}>
                  <RenderHtml contentWidth={cellWidth - 12} tagsStyles={tagsStyles} renderersProps={renderersProps}
                    source={{ html: `<div>${serialize(cell.children)}</div>`, baseUrl }} />
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    );
  };
}

export function OfflineReader({ article, server, onArticle, onFragmentMissing, scrollRef, targetFragment }: {
  article: CachedArticle;
  server: string;
  onArticle: (slug: string, fragment: string) => void;
  onFragmentMissing: (message: string) => void;
  scrollRef: React.RefObject<ScrollView | null>;
  targetFragment?: string;
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const baseUrl = `${canonicalServer(server)}/knowledge/${encodeURIComponent(article.slug)}`;
  const ys = useRef<Record<number, number>>({});
  const baseY = useRef(0);

  const { blocks, ids } = useMemo(() => {
    const html = readerHtml(article, server);
    const doc = parseDocument(html);
    const blocks: string[] = [];
    const ids: Record<string, number> = {};
    doc.children.forEach(n => {
      const s = serialize(n);
      if (!s.trim()) return;
      findIds([n], blocks.length, ids);
      blocks.push(s);
    });
    return { blocks, ids };
  }, [article, server]);

  const tagsStyles = useMemo(() => ({
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
    th: { fontWeight: '600' as const, color: colors.foreground },
    td: { color: colors.foreground },
    img: { borderRadius: 4 },
  }), [colors]);

  const jump = useCallback((fragment: string) => {
    let id = fragment;
    try { id = decodeURIComponent(fragment); } catch { /* keep raw */ }
    const block = ids[id] ?? ids[fragment];
    if (block === undefined) { onFragmentMissing('That source or heading is not in the saved copy of this article.'); return; }
    const y = ys.current[block];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, baseY.current + y - 8), animated: true });
  }, [ids, onFragmentMissing, scrollRef]);

  const jumped = useRef<string>('');
  const onLayoutBlock = (i: number, y: number) => {
    ys.current[i] = y;
    if (targetFragment && jumped.current !== `${article.slug}#${targetFragment}` && i === blocks.length - 1) {
      jumped.current = `${article.slug}#${targetFragment}`;
      setTimeout(() => jump(targetFragment), 50);
    }
  };

  const onLinkPress = useCallback((_e: unknown, href: string) => {
    if (href.startsWith('#')) { jump(href.slice(1)); return; }
    const link = articleLink(href, server);
    if (link) {
      if (link.slug === article.slug && link.fragment) jump(link.fragment);
      else onArticle(link.slug, link.fragment);
      return;
    }
    onFragmentMissing('External links are not opened in this reader.');
  }, [article.slug, server, jump, onArticle, onFragmentMissing]);
  const renderers = useMemo(() => ({ table: makeTable(colors, tagsStyles, { a: { onPress: onLinkPress } }, baseUrl) }), [colors, tagsStyles, onLinkPress, baseUrl]);

  return (
    <View onLayout={e => { baseY.current = e.nativeEvent.layout.y; }} testID="reader-content">
      {blocks.map((html, i) => (
        <View key={i} onLayout={e => onLayoutBlock(i, e.nativeEvent.layout.y)}>
          <RenderHtml contentWidth={width - 32} source={{ html, baseUrl }} tagsStyles={tagsStyles} customHTMLElementModels={models}
            renderers={renderers} renderersProps={{ a: { onPress: onLinkPress } }}
            defaultTextProps={{ selectable: true }} enableExperimentalMarginCollapsing />
        </View>
      ))}
      <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 8 }}>
        Read-only copy. Editors, external sites and external images are not available here.
      </Text>
    </View>
  );
}
