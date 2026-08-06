import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

export interface CachedTag {
  id: number;
  name: string;
  color: string;
}

export interface CachedArticle {
  id: number;
  slug: string;
  title: string;
  content: string;
  searchText: string;   // stripped HTML for offline search
  contentCached: boolean;
  tags: CachedTag[];
  updatedAt: string;
  createdAt: string;
  updatedByName: string | null;
  isRestricted: boolean;
  canAccess: boolean;
}

export interface SyncProgress {
  current: number;
  total: number;
  phase: 'summaries' | 'content' | 'done';
}

interface AppContextValue {
  // Connection
  serverUrl: string | null;
  setServerUrl: (url: string) => Promise<void>;
  testConnection: (url: string) => Promise<boolean>;

  // Auth
  user: AuthUser | null;
  sessionCookie: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;

  // Offline
  isOnline: boolean;

  // Article cache
  cachedArticles: CachedArticle[];
  cachedTags: CachedTag[];
  lastSyncedAt: Date | null;
  isSyncing: boolean;
  syncProgress: SyncProgress | null;
  syncArticles: () => Promise<void>;
  getArticle: (slug: string) => Promise<CachedArticle | null>;

  // API fetch helper
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
}

// ─── Storage keys ────────────────────────────────────────────────────────────

const KEY_SERVER_URL = '@memex/server_url';
const KEY_SESSION = '@memex/session_cookie';
const KEY_USER = '@memex/user';
const KEY_ARTICLES = '@memex/articles';
const KEY_TAGS = '@memex/tags';
const KEY_LAST_SYNCED = '@memex/last_synced';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/connect\.sid=([^;]+)/);
  return match?.[1] ?? null;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionCookie, setSessionCookie] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [cachedArticles, setCachedArticles] = useState<CachedArticle[]>([]);
  const [cachedTags, setCachedTags] = useState<CachedTag[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const isSyncingRef = useRef(false);

  // ── Load persisted state on mount ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [url, cookie, userJson, articlesJson, tagsJson, lastSync] = await Promise.all([
        AsyncStorage.getItem(KEY_SERVER_URL),
        AsyncStorage.getItem(KEY_SESSION),
        AsyncStorage.getItem(KEY_USER),
        AsyncStorage.getItem(KEY_ARTICLES),
        AsyncStorage.getItem(KEY_TAGS),
        AsyncStorage.getItem(KEY_LAST_SYNCED),
      ]);
      if (url) setServerUrlState(url);
      if (cookie) setSessionCookie(cookie);
      if (userJson) { try { setUser(JSON.parse(userJson)); } catch { /* ignore */ } }
      if (articlesJson) { try { setCachedArticles(JSON.parse(articlesJson)); } catch { /* ignore */ } }
      if (tagsJson) { try { setCachedTags(JSON.parse(tagsJson)); } catch { /* ignore */ } }
      if (lastSync) setLastSyncedAt(new Date(lastSync));
    })();
  }, []);

  // ── Network state ──────────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected ?? false);
    });
    return unsubscribe;
  }, []);

  // ── Core API fetch ─────────────────────────────────────────────────────────
  const apiFetch = useCallback(
    async (path: string, options: RequestInit = {}) => {
      if (!serverUrl) throw new Error('Server URL not configured');
      const url = `${serverUrl}/api${path}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(sessionCookie ? { Cookie: `connect.sid=${sessionCookie}` } : {}),
        ...(options.headers as Record<string, string> | undefined),
      };
      return fetch(url, { ...options, headers });
    },
    [serverUrl, sessionCookie],
  );

  // ── Server URL ────────────────────────────────────────────────────────────
  const setServerUrl = useCallback(async (url: string) => {
    const trimmed = url.replace(/\/+$/, ''); // remove trailing slashes
    await AsyncStorage.setItem(KEY_SERVER_URL, trimmed);
    setServerUrlState(trimmed);
  }, []);

  const testConnection = useCallback(
    async (url: string): Promise<boolean> => {
      try {
        const trimmed = url.replace(/\/+$/, '');
        const res = await fetch(`${trimmed}/api/healthz`, { signal: AbortSignal.timeout(5000) });
        return res.ok;
      } catch {
        return false;
      }
    },
    [],
  );

  // ── Auth ──────────────────────────────────────────────────────────────────
  const login = useCallback(
    async (email: string, password: string) => {
      if (!serverUrl) throw new Error('Server URL not configured');
      const res = await fetch(`${serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Invalid credentials');
      }
      const userData = await res.json() as AuthUser;
      const cookie = extractCookie(res.headers.get('set-cookie'));
      await Promise.all([
        AsyncStorage.setItem(KEY_USER, JSON.stringify(userData)),
        cookie ? AsyncStorage.setItem(KEY_SESSION, cookie) : Promise.resolve(),
      ]);
      setUser(userData);
      if (cookie) setSessionCookie(cookie);
    },
    [serverUrl],
  );

  const logout = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(KEY_SESSION),
      AsyncStorage.removeItem(KEY_USER),
    ]);
    setUser(null);
    setSessionCookie(null);
  }, []);

  // ── Sync ──────────────────────────────────────────────────────────────────
  const syncArticles = useCallback(async () => {
    if (isSyncingRef.current || !serverUrl || !sessionCookie) return;
    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      // Fetch article summaries
      setSyncProgress({ current: 0, total: 0, phase: 'summaries' });
      let allSlugs: string[] = [];
      let offset = 0;
      const limit = 100;
      while (true) {
        const res = await apiFetch(`/articles?limit=${limit}&offset=${offset}&sort=updated_at&order=desc`);
        if (!res.ok) break;
        const data = await res.json() as { articles: { slug: string; id: number; title: string; updatedAt: string; createdAt: string; updatedByName: string | null; isRestricted: boolean; canAccess: boolean; tags: CachedTag[] }[]; total: number };
        allSlugs = allSlugs.concat(data.articles.map((a) => a.slug));

        // Build partial cache from summaries first (shows immediately)
        const existing = new Map(cachedArticles.map((a) => [a.slug, a]));
        for (const article of data.articles) {
          if (!existing.has(article.slug)) {
            existing.set(article.slug, {
              id: article.id,
              slug: article.slug,
              title: article.title,
              content: '',
              searchText: article.title,
              contentCached: false,
              tags: article.tags ?? [],
              updatedAt: article.updatedAt,
              createdAt: article.createdAt,
              updatedByName: article.updatedByName,
              isRestricted: article.isRestricted,
              canAccess: article.canAccess,
            });
          }
        }
        const partial = Array.from(existing.values());
        setCachedArticles(partial);

        if (offset + limit >= data.total) break;
        offset += limit;
      }

      // Fetch full content for each article in batches
      setSyncProgress({ current: 0, total: allSlugs.length, phase: 'content' });

      const BATCH = 8;
      const updatedMap = new Map(cachedArticles.map((a) => [a.slug, a]));

      for (let i = 0; i < allSlugs.length; i += BATCH) {
        const batch = allSlugs.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map((slug) => apiFetch(`/articles/${slug}`).then((r) => r.json() as Promise<{
            id: number; slug: string; title: string; content: string; updatedAt: string; createdAt: string;
            updatedByName: string | null; isRestricted: boolean; canAccess: boolean;
            tags: CachedTag[]; groups: unknown[];
          }>)),
        );
        for (const res of results) {
          if (res.status === 'fulfilled') {
            const a = res.value;
            updatedMap.set(a.slug, {
              id: a.id,
              slug: a.slug,
              title: a.title,
              content: a.content,
              searchText: `${a.title} ${stripHtml(a.content)}`.toLowerCase(),
              contentCached: true,
              tags: a.tags ?? [],
              updatedAt: a.updatedAt,
              createdAt: a.createdAt,
              updatedByName: a.updatedByName,
              isRestricted: a.isRestricted,
              canAccess: a.canAccess,
            });
          }
        }
        setSyncProgress({ current: Math.min(i + BATCH, allSlugs.length), total: allSlugs.length, phase: 'content' });
      }

      const finalArticles = Array.from(updatedMap.values());
      const now = new Date();
      await Promise.all([
        AsyncStorage.setItem(KEY_ARTICLES, JSON.stringify(finalArticles)),
        AsyncStorage.setItem(KEY_LAST_SYNCED, now.toISOString()),
      ]);
      setCachedArticles(finalArticles);
      setLastSyncedAt(now);

      // Sync tags
      const tagsRes = await apiFetch('/tags');
      if (tagsRes.ok) {
        const tags = await tagsRes.json() as CachedTag[];
        await AsyncStorage.setItem(KEY_TAGS, JSON.stringify(tags));
        setCachedTags(tags);
      }
    } finally {
      setSyncProgress({ current: 0, total: 0, phase: 'done' });
      setIsSyncing(false);
      isSyncingRef.current = false;
    }
  }, [serverUrl, sessionCookie, apiFetch, cachedArticles]);

  // ── Get single article (live or cache) ───────────────────────────────────
  const getArticle = useCallback(
    async (slug: string): Promise<CachedArticle | null> => {
      if (isOnline && sessionCookie) {
        try {
          const res = await apiFetch(`/articles/${slug}`);
          if (res.ok) {
            const a = await res.json() as { id: number; slug: string; title: string; content: string; updatedAt: string; createdAt: string; updatedByName: string | null; isRestricted: boolean; canAccess: boolean; tags: CachedTag[] };
            const article: CachedArticle = {
              id: a.id, slug: a.slug, title: a.title, content: a.content,
              searchText: `${a.title} ${stripHtml(a.content)}`.toLowerCase(),
              contentCached: true, tags: a.tags ?? [],
              updatedAt: a.updatedAt, createdAt: a.createdAt,
              updatedByName: a.updatedByName, isRestricted: a.isRestricted, canAccess: a.canAccess,
            };
            // Update cache entry
            setCachedArticles((prev) => {
              const next = prev.filter((x) => x.slug !== slug);
              return [article, ...next];
            });
            return article;
          }
        } catch { /* fall through to cache */ }
      }
      return cachedArticles.find((a) => a.slug === slug) ?? null;
    },
    [isOnline, sessionCookie, apiFetch, cachedArticles],
  );

  return (
    <AppContext.Provider
      value={{
        serverUrl, setServerUrl, testConnection,
        user, sessionCookie, login, logout,
        isOnline,
        cachedArticles, cachedTags, lastSyncedAt, isSyncing, syncProgress, syncArticles, getArticle,
        apiFetch,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
