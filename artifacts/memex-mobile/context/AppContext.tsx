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
const LEGACY_CACHE_KEYS = ['@memex/articles', '@memex/tags', '@memex/last_synced'];
const articlesKey = (userId: number) => `@memex/user/${userId}/articles`;
const tagsKey = (userId: number) => `@memex/user/${userId}/tags`;
const lastSyncedKey = (userId: number) => `@memex/user/${userId}/last_synced`;

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
  // Auth state changes can race with storage and network work.  This token is
  // deliberately a ref so it changes synchronously, before React renders the
  // next identity.
  const authGenerationRef = useRef(0);
  const authIdentityRef = useRef<string | null>(null);
  const syncOwnerRef = useRef<number | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const sessionRef = useRef<string | null>(null);
  const articlesRef = useRef<CachedArticle[]>([]);
  const articlesRevisionRef = useRef(0);
  const authorityRevisionRef = useRef(0);
  const articleWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const identityFor = (value: AuthUser | null, cookie: string | null) =>
    value && cookie ? `${value.id}:${cookie}` : null;
  const isCurrentAuth = (generation: number, identity: string | null) =>
    authGenerationRef.current === generation && authIdentityRef.current === identity;
  // Keep React state, the in-memory source of truth, and disk writes in one
  // order. A queued write verifies its revision when it executes, so a slow
  // older AsyncStorage operation cannot become the final on-disk cache.
  const commitArticles = (
    next: CachedArticle[],
    generation: number,
    identity: string | null,
    userId: number,
  ) => {
    if (!isCurrentAuth(generation, identity)) return false;
    articlesRef.current = next;
    setCachedArticles(next);
    const revision = ++articlesRevisionRef.current;
    articleWriteQueueRef.current = articleWriteQueueRef.current
      .catch(() => {})
      .then(async () => {
        if (!isCurrentAuth(generation, identity) || articlesRevisionRef.current !== revision) return;
        await AsyncStorage.setItem(articlesKey(userId), JSON.stringify(next));
      });
    return true;
  };

  // ── Load persisted state on mount ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const generation = authGenerationRef.current;
      const startingIdentity = authIdentityRef.current;
      const [url, cookie, userJson] = await Promise.all([
        AsyncStorage.getItem(KEY_SERVER_URL),
        AsyncStorage.getItem(KEY_SESSION),
        AsyncStorage.getItem(KEY_USER),
      ]);
      await AsyncStorage.multiRemove(LEGACY_CACHE_KEYS);
      if (!isCurrentAuth(generation, startingIdentity)) return;
      if (url) setServerUrlState(url);
      let storedUser: AuthUser | null = null;
      if (userJson) {
        try {
          storedUser = JSON.parse(userJson) as AuthUser;
        } catch { /* ignore */ }
      }
      const storedIdentity = identityFor(storedUser, cookie);
      // A stored user without a session is not an authenticated cache owner.
      const [articlesJson, tagsJson, lastSync] = storedIdentity && storedUser
        ? await Promise.all([
            AsyncStorage.getItem(articlesKey(storedUser.id)),
            AsyncStorage.getItem(tagsKey(storedUser.id)),
            AsyncStorage.getItem(lastSyncedKey(storedUser.id)),
          ])
        : [null, null, null];
      // Do not expose this identity until all of its persisted data is ready.
      // This prevents the first authoritative sync from racing a late cache
      // read and being overwritten by it.
      if (!isCurrentAuth(generation, startingIdentity)) return;
      let storedArticles: CachedArticle[] = [];
      if (articlesJson) { try { storedArticles = JSON.parse(articlesJson) as CachedArticle[]; } catch { /* ignore */ } }
      let storedTags: CachedTag[] = [];
      if (tagsJson) { try { storedTags = JSON.parse(tagsJson) as CachedTag[]; } catch { /* ignore */ } }
      if (storedIdentity && storedUser) {
        articlesRef.current = storedArticles;
        articlesRevisionRef.current += 1;
        setCachedArticles(storedArticles);
        setCachedTags(storedTags);
        setLastSyncedAt(lastSync ? new Date(lastSync) : null);
        authIdentityRef.current = storedIdentity;
        userRef.current = storedUser;
        sessionRef.current = cookie;
        setUser(storedUser);
        setSessionCookie(cookie);
      }
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
      const previousUserId = userRef.current?.id;
      // Invalidate outstanding work before any asynchronous identity cleanup.
      authGenerationRef.current += 1;
      const generation = authGenerationRef.current;
      const nextIdentity = identityFor(userData, cookie);
      authIdentityRef.current = nextIdentity;
      userRef.current = userData;
      sessionRef.current = cookie;
      syncOwnerRef.current = null;
      articlesRef.current = [];
      articlesRevisionRef.current += 1;
      authorityRevisionRef.current += 1;
      setIsSyncing(false);
      setSyncProgress(null);
      setCachedArticles([]);
      setCachedTags([]);
      setLastSyncedAt(null);
      setUser(userData);
      setSessionCookie(cookie);
      const keysToRemove = previousUserId
        ? [articlesKey(previousUserId), tagsKey(previousUserId), lastSyncedKey(previousUserId)]
        : [];
      await Promise.all([
        AsyncStorage.setItem(KEY_USER, JSON.stringify(userData)),
        cookie ? AsyncStorage.setItem(KEY_SESSION, cookie) : AsyncStorage.removeItem(KEY_SESSION),
        keysToRemove.length > 0 ? AsyncStorage.multiRemove(keysToRemove) : Promise.resolve(),
        AsyncStorage.multiRemove([articlesKey(userData.id), tagsKey(userData.id), lastSyncedKey(userData.id)]),
      ]);
      // Login cannot be superseded by another identity while its writes are
      // underway without that transition incrementing the generation.
      if (!isCurrentAuth(generation, nextIdentity)) return;
    },
    [serverUrl],
  );

  const logout = useCallback(async () => {
    const previousUser = userRef.current;
    // Do this before awaiting storage so old requests cannot write back.
    authGenerationRef.current += 1;
    authIdentityRef.current = null;
    userRef.current = null;
    sessionRef.current = null;
    syncOwnerRef.current = null;
    articlesRef.current = [];
    articlesRevisionRef.current += 1;
    authorityRevisionRef.current += 1;
    setIsSyncing(false);
    setSyncProgress(null);
    setCachedArticles([]);
    setCachedTags([]);
    setLastSyncedAt(null);
    setUser(null);
    setSessionCookie(null);
    const userCacheKeys = previousUser
      ? [articlesKey(previousUser.id), tagsKey(previousUser.id), lastSyncedKey(previousUser.id)]
      : [];
    await Promise.all([
      AsyncStorage.removeItem(KEY_SESSION),
      AsyncStorage.removeItem(KEY_USER),
      userCacheKeys.length > 0 ? AsyncStorage.multiRemove(userCacheKeys) : Promise.resolve(),
    ]);
  }, []);

  // ── Sync ──────────────────────────────────────────────────────────────────
  const syncArticles = useCallback(async () => {
    const generation = authGenerationRef.current;
    const syncUser = userRef.current;
    const syncCookie = sessionRef.current;
    const identity = identityFor(syncUser, syncCookie);
    if (!identity || !syncUser || !serverUrl || !syncCookie || syncOwnerRef.current === generation) return;
    syncOwnerRef.current = generation;
    setIsSyncing(true);

    try {
      // Fetch article summaries
      if (!isCurrentAuth(generation, identity)) return;
      setSyncProgress({ current: 0, total: 0, phase: 'summaries' });
      let allSlugs: string[] = [];
      const accessibleSummaries: Array<{
        slug: string; id: number; title: string; updatedAt: string; createdAt: string;
        updatedByName: string | null; isRestricted: boolean; canAccess: boolean; tags: CachedTag[];
      }> = [];
      let offset = 0;
      const limit = 100;
      while (true) {
        const res = await apiFetch(`/articles?limit=${limit}&offset=${offset}&sort=updated_at&order=desc`);
        if (!isCurrentAuth(generation, identity)) return;
        if (!res.ok) break;
        const data = await res.json() as { articles: { slug: string; id: number; title: string; updatedAt: string; createdAt: string; updatedByName: string | null; isRestricted: boolean; canAccess: boolean; tags: CachedTag[] }[]; total: number };
        allSlugs = allSlugs.concat(data.articles.map((a) => a.slug));
        accessibleSummaries.push(...data.articles);

        if (offset + limit >= data.total) break;
        offset += limit;
      }

      // The server's complete summary set is authoritative. Preserve content
      // only for slugs that remain accessible and evict revoked entries now.
      const previousBySlug = new Map(articlesRef.current.map((article) => [article.slug, article]));
      const summaryArticles: CachedArticle[] = accessibleSummaries.map((article) => {
        const previous = previousBySlug.get(article.slug);
        return {
          id: article.id,
          slug: article.slug,
          title: article.title,
          content: previous?.content ?? '',
          searchText: previous?.searchText ?? article.title.toLowerCase(),
          contentCached: previous?.contentCached ?? false,
          tags: article.tags ?? [],
          updatedAt: article.updatedAt,
          createdAt: article.createdAt,
          updatedByName: article.updatedByName,
          isRestricted: article.isRestricted,
          canAccess: article.canAccess,
        };
      });
      if (!isCurrentAuth(generation, identity)) return;
      authorityRevisionRef.current += 1;
      let expectedAuthorityRevision = authorityRevisionRef.current;
      if (!commitArticles(summaryArticles, generation, identity, syncUser.id)) return;

      // Fetch full content for each article in batches
      setSyncProgress({ current: 0, total: allSlugs.length, phase: 'content' });

      const BATCH = 8;
      const updatedMap = new Map(summaryArticles.map((a) => [a.slug, a]));

      for (let i = 0; i < allSlugs.length; i += BATCH) {
        const batch = allSlugs.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(async (slug) => {
            const response = await apiFetch(`/articles/${slug}`);
            if (!response.ok) return { slug, status: response.status };
            const article = await response.json() as {
              id: number; slug: string; title: string; content: string; updatedAt: string; createdAt: string;
              updatedByName: string | null; isRestricted: boolean; canAccess: boolean;
              tags: CachedTag[]; groups: unknown[];
            };
            return { slug, status: response.status, article };
          }),
        );
        if (!isCurrentAuth(generation, identity)) return;
        let revokedInBatch = false;
        for (const res of results) {
          if (res.status === 'fulfilled' && res.value.article) {
            const a = res.value.article;
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
          } else if (res.status === 'fulfilled' && (res.value.status === 403 || res.value.status === 404)) {
            // Authorization loss is definitive; transient failures retain the
            // already-cached body.
            updatedMap.delete(res.value.slug);
            revokedInBatch = true;
          }
        }
        const batchArticles = Array.from(updatedMap.values());
        if (!isCurrentAuth(generation, identity)) return;
        // A live 403/404 received while syncing is a newer authorization
        // decision than this batch's snapshot. Stop rather than writing this
        // stale map back over that eviction.
        if (authorityRevisionRef.current !== expectedAuthorityRevision) return;
        if (revokedInBatch) authorityRevisionRef.current += 1;
        expectedAuthorityRevision = authorityRevisionRef.current;
        if (!commitArticles(batchArticles, generation, identity, syncUser.id)) return;
        setSyncProgress({ current: Math.min(i + BATCH, allSlugs.length), total: allSlugs.length, phase: 'content' });
      }

      const finalArticles = Array.from(updatedMap.values());
      const now = new Date();
      if (!isCurrentAuth(generation, identity)) return;
      if (authorityRevisionRef.current !== expectedAuthorityRevision) return;
      if (!commitArticles(finalArticles, generation, identity, syncUser.id)) return;
      await AsyncStorage.setItem(lastSyncedKey(syncUser.id), now.toISOString());
      if (!isCurrentAuth(generation, identity)) return;
      setLastSyncedAt(now);

      // Sync tags
      const tagsRes = await apiFetch('/tags');
      if (!isCurrentAuth(generation, identity)) return;
      if (tagsRes.ok) {
        const tags = await tagsRes.json() as CachedTag[];
        if (!isCurrentAuth(generation, identity)) return;
        await AsyncStorage.setItem(tagsKey(syncUser.id), JSON.stringify(tags));
        if (!isCurrentAuth(generation, identity)) return;
        setCachedTags(tags);
      }
    } finally {
      // An old sync may finish after another user has started syncing.  It
      // must not clear that user's spinner or progress.
      if (syncOwnerRef.current === generation && isCurrentAuth(generation, identity)) {
        setSyncProgress({ current: 0, total: 0, phase: 'done' });
        setIsSyncing(false);
        syncOwnerRef.current = null;
      }
    }
  }, [serverUrl, sessionCookie, apiFetch]);

  // ── Get single article (live or cache) ───────────────────────────────────
  const getArticle = useCallback(
    async (slug: string): Promise<CachedArticle | null> => {
      const generation = authGenerationRef.current;
      const articleUser = userRef.current;
      const articleCookie = sessionRef.current;
      const identity = identityFor(articleUser, articleCookie);
      const authorityRevision = authorityRevisionRef.current;
      if (!identity || !articleUser || !articleCookie) return null;
      if (isOnline) {
        try {
          const res = await apiFetch(`/articles/${slug}`);
          if (!isCurrentAuth(generation, identity)) return null;
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
            // A summary/revocation that landed while this request was in
            // flight is authoritative; never let this response resurrect it.
            if (!isCurrentAuth(generation, identity) || authorityRevisionRef.current !== authorityRevision) return null;
            const next = [article, ...articlesRef.current.filter((x) => x.slug !== slug)];
            if (!commitArticles(next, generation, identity, articleUser.id)) return null;
            if (!isCurrentAuth(generation, identity)) return null;
            return article;
          }
          if (res.status === 403 || res.status === 404) {
            const next = articlesRef.current.filter((article) => article.slug !== slug);
            if (!isCurrentAuth(generation, identity)) return null;
            authorityRevisionRef.current += 1;
            if (!commitArticles(next, generation, identity, articleUser.id)) return null;
            if (!isCurrentAuth(generation, identity)) return null;
            return null;
          }
        } catch {
          if (!isCurrentAuth(generation, identity)) return null;
          // A network failure is not proof that access was revoked.
        }
      }
      if (!isCurrentAuth(generation, identity)) return null;
      return articlesRef.current.find((a) => a.slug === slug) ?? null;
    },
    [isOnline, apiFetch],
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
