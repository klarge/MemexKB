import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { OfflineLibrary, Cancelled, SessionExpired } from '../offline/library';
import { DeviceOfflineStore } from '../offline/store';
import { canonicalServer, textFromHtml } from '../offline/content';
import { deleteSession, loadSession, saveSession, OFFLINE_ACCESS_MS, type AuthUser, type SavedSession } from '../offline/credentials';
import type { CacheScope, CachedArticle, CachedTag, LibraryState, SyncProgress } from '../offline/types';
import { fetchWithTimeout } from '../offline/network';
import { nativeSso, revokeNativeSession } from '../offline/sso';
import { useQueryClient } from '@tanstack/react-query';

export type { AuthUser, CachedArticle, CachedTag, SyncProgress };
interface AppContextValue {
  serverUrl: string | null;
  setServerUrl: (url: string) => Promise<void>;
  testConnection: (url: string) => Promise<boolean>;
  user: AuthUser | null;
  sessionCookie: string | null;
  login: (email: string, password: string) => Promise<void>;
  loginSso: (providerId: number) => Promise<boolean>;
  logout: () => Promise<void>;
  isOnline: boolean;
  isHydrating: boolean;
  cachedArticles: CachedArticle[];
  cachedTags: CachedTag[];
  lastSyncedAt: Date | null;
  isSyncing: boolean;
  syncProgress: SyncProgress | null;
  downloadError: string | null;
  syncArticles: () => Promise<void>;
  downloadAllArticles: () => Promise<void>;
  downloadArticle: (slug: string) => Promise<CachedArticle | null>;
  removeDownload: (slug: string) => Promise<void>;
  clearDownloads: () => Promise<void>;
  getArticle: (slug: string) => Promise<CachedArticle | null>;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
}
const SERVER_KEY = '@memex/server_url';
const AppContext = createContext<AppContextValue | null>(null);
const empty: LibraryState = { articles: [], lastSyncedAt: null, busy: false, progress: null, error: null };
const scopeFor = (session: SavedSession): CacheScope => ({ server: session.server, userId: session.user.id, cookie: session.cookie });

function headers(cookie: string | null): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Memex-Client': 'native',
    ...(cookie && Platform.OS !== 'web' ? { Cookie: `connect.sid=${cookie}` } : {}) };
}
export function AppProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const [session, setSession] = useState<SavedSession | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isHydrating, setIsHydrating] = useState(true);
  const [libraryState, setLibraryState] = useState(empty);
  const sessionRef = useRef<SavedSession | null>(null);
  const serverRef = useRef<string | null>(null);
  const authGeneration = useRef(0);
  const credentialQueue = useRef<Promise<unknown>>(Promise.resolve());
  const storeRef = useRef(new DeviceOfflineStore());
  const logoutRef = useRef<() => Promise<void>>(async () => {});
  const libraryRef = useRef<OfflineLibrary | null>(null);
  if (!libraryRef.current) libraryRef.current = new OfflineLibrary(storeRef.current,
    (scope, path, method) => fetchWithTimeout(`${scope.server}/api${path}`, {
      method, credentials: 'include', headers: headers(scope.cookie), redirect: 'error',
    }),
    setLibraryState,
    () => { void logoutRef.current(); },
  );
  const library = libraryRef.current;
  const persist = (operation: () => Promise<void>) => {
    const promise = credentialQueue.current.then(operation);
    credentialQueue.current = promise.catch(() => {});
    return promise;
  };

  const logout = useCallback(async () => {
    const previous = sessionRef.current;
    authGeneration.current++;
    sessionRef.current = null;
    setSession(null);
    queryClient.clear();
    await library.activate(null); // Invalidates all outstanding reads before storage awaits.
    await persist(deleteSession);
    if (previous) {
      await storeRef.current.clear(scopeFor(previous));
      await AsyncStorage.multiRemove([`@memex/user/${previous.user.id}/articles`, `@memex/user/${previous.user.id}/tags`, `@memex/user/${previous.user.id}/last_synced`]);
      // Best-effort server revocation; local private downloads are cleared even offline.
      void fetchWithTimeout(`${previous.server}/api/auth/logout`, {
        method: 'POST', credentials: 'include', headers: headers(previous.cookie),
      }, 5000).catch(() => {});
    }
  }, [library, queryClient]);
  logoutRef.current = logout;

  useEffect(() => {
    let cancelled = false;
    const generation = authGeneration.current;
    void (async () => {
      try {
        const savedServer = await AsyncStorage.getItem(SERVER_KEY);
        if (cancelled || generation !== authGeneration.current) return;
        if (savedServer) { serverRef.current = canonicalServer(savedServer); setServerUrlState(serverRef.current); }
        let saved = await loadSession();
        // Migrate the existing user's text cache without trusting cross-server
        // or account-independent legacy caches.
        if (!saved && savedServer) {
          const [cookie, profile] = await Promise.all([AsyncStorage.getItem('@memex/session_cookie'), AsyncStorage.getItem('@memex/user')]);
          if (cookie && profile) {
            const user = JSON.parse(profile) as AuthUser;
            if (Number.isSafeInteger(user.id)) {
              const last = await AsyncStorage.getItem(`@memex/user/${user.id}/last_synced`);
              const validated = last ? Date.parse(last) : Date.now();
              saved = { server: canonicalServer(savedServer), cookie, user, offlineUntil: validated + OFFLINE_ACCESS_MS };
              const json = await AsyncStorage.getItem(`@memex/user/${user.id}/articles`);
              const articles = json ? JSON.parse(json) as CachedArticle[] : [];
              for (const article of articles) {
                if (article.canAccess === true && article.contentCached && typeof article.content === 'string') {
                  await storeRef.current.save(scopeFor(saved), { ...article,
                    searchText: `${article.title} ${textFromHtml(article.content)}`.toLowerCase(),
                    downloadedAt: last ?? undefined, downloadComplete: false, assetFiles: {},
                    downloadError: 'Text migrated. Download again to save images and finish this article.',
                  }, () => !cancelled && generation === authGeneration.current);
                }
              }
              if (!cancelled && generation === authGeneration.current) {
                await persist(() => saveSession(saved!));
                await AsyncStorage.multiRemove([`@memex/user/${user.id}/articles`, `@memex/user/${user.id}/tags`, `@memex/user/${user.id}/last_synced`]);
              }
            }
          }
        }
        if (cancelled || generation !== authGeneration.current) return;
        await AsyncStorage.multiRemove(['@memex/session_cookie', '@memex/user', '@memex/articles', '@memex/tags', '@memex/last_synced']);
        if (saved && saved.server === serverRef.current && saved.offlineUntil > Date.now()) {
          sessionRef.current = saved;
          await library.activate(scopeFor(saved));
          if (cancelled || generation !== authGeneration.current) return;
          setSession(saved);
        } else if (saved) {
          await storeRef.current.clear(scopeFor(saved));
          await persist(deleteSession);
        }
      } catch (error) {
        if (!cancelled) setLibraryState(state => ({ ...state, error: error instanceof Error ? error.message : 'Unable to load saved articles.' }));
      } finally { if (!cancelled) setIsHydrating(false); }
    })();
    return () => { cancelled = true; };
  }, [library]);

  useEffect(() => NetInfo.addEventListener(state => {
    setIsOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
  }), []);
  useEffect(() => {
    if (!session) return;
    const timeout = setTimeout(() => { void logout(); }, Math.max(0, session.offlineUntil - Date.now()));
    return () => clearTimeout(timeout);
  }, [session, logout]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active' || !sessionRef.current) return;
      if (sessionRef.current.offlineUntil <= Date.now()) void logout();
      else if (isOnline) void library.refresh();
    });
    return () => listener.remove();
  }, [isOnline, library, logout]);

  const setServerUrl = useCallback(async (value: string) => {
    const server = value.trim() ? canonicalServer(value) : null;
    if (server !== serverRef.current) await logout();
    serverRef.current = server;
    setServerUrlState(server);
    if (server) await AsyncStorage.setItem(SERVER_KEY, server);
    else await AsyncStorage.removeItem(SERVER_KEY);
  }, [logout]);
  const testConnection = useCallback(async (value: string) => {
    try { return (await fetchWithTimeout(`${canonicalServer(value)}/api/healthz`, {}, 5000)).ok; }
    catch { return false; }
  }, []);
  const acceptSession = useCallback(async (server: string, generation: number, user: AuthUser, cookie: string) => {
    if (generation !== authGeneration.current || server !== serverRef.current) return false;
    const previous = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    queryClient.clear();
    await library.activate(null);
    if (previous) await storeRef.current.clear(scopeFor(previous));
    if (generation !== authGeneration.current || server !== serverRef.current) return false;
    await persist(deleteSession);
    const saved: SavedSession = { server, cookie, user, offlineUntil: Date.now() + OFFLINE_ACCESS_MS };
    await persist(async () => { if (generation === authGeneration.current) await saveSession(saved); });
    if (generation !== authGeneration.current || server !== serverRef.current) return false;
    sessionRef.current = saved;
    await library.activate(scopeFor(saved));
    if (generation !== authGeneration.current) return false;
    setSession(saved);
    return true;
  }, [library, queryClient]);
  const login = useCallback(async (email: string, password: string) => {
    const server = serverRef.current;
    if (!server) throw new Error('Server URL not configured.');
    const generation = ++authGeneration.current;
    const res = await fetchWithTimeout(`${server}/api/auth/login`, {
      method: 'POST', credentials: 'include', headers: headers(null), body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(error.error ?? 'Sign-in failed.');
    }
    const user = await res.json() as AuthUser;
    const cookie = Platform.OS === 'web' ? 'browser-session' : /connect\.sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
    if (!cookie || !Number.isSafeInteger(user.id)) throw new Error('The server did not return a valid session.');
    await acceptSession(server, generation, user, cookie);
  }, [acceptSession]);
  const loginSso = useCallback(async (providerId: number) => {
    const server = serverRef.current;
    if (!server) throw new Error('Server URL not configured.');
    if (Platform.OS === 'web') throw new Error('Use the installed Android app for native SSO sign-in.');
    const generation = ++authGeneration.current;
    const result = await nativeSso(server, providerId, () => generation === authGeneration.current && server === serverRef.current);
    if (!result) return false;
    try {
      const accepted = await acceptSession(server, generation, result.user, result.cookie);
      if (!accepted) void revokeNativeSession(server, result.cookie);
      return accepted;
    } catch (error) {
      void revokeNativeSession(server, result.cookie);
      throw error;
    }
  }, [acceptSession]);
  const apiFetch = useCallback(async (path: string, options: RequestInit = {}) => {
    const server = serverRef.current;
    if (!server) throw new Error('Server URL not configured.');
    return fetchWithTimeout(`${server}/api${path}`, { ...options, credentials: 'include',
      headers: { ...headers(sessionRef.current?.cookie ?? null), ...(options.headers as Record<string, string> | undefined) },
    });
  }, []);
  const syncArticles = useCallback(async () => { if (isOnline) await library.refresh(false); }, [library, isOnline]);
  const downloadAllArticles = useCallback(async () => { if (isOnline) await library.refresh(true); }, [library, isOnline]);
  const downloadArticle = useCallback(async (slug: string) => {
    if (!isOnline) throw new Error('Connect to download this article.');
    return library.download(slug);
  }, [library, isOnline]);
  const getArticle = useCallback(async (slug: string) => {
    if (isOnline) {
      try { return await library.download(slug); }
      catch (error) {
        if (error instanceof SessionExpired || error instanceof Cancelled) return null;
        // A transient network/asset failure is not proof of revoked access.
      }
    }
    return library.cached(slug);
  }, [library, isOnline]);
  const cachedTags = [...new Map(libraryState.articles.flatMap(a => a.tags ?? []).map(tag => [tag.id, tag])).values()];
  return <AppContext.Provider value={{
    serverUrl, setServerUrl, testConnection, user: session?.user ?? null, sessionCookie: session?.cookie ?? null,
    login, loginSso, logout, isOnline, isHydrating, cachedArticles: libraryState.articles, cachedTags,
    lastSyncedAt: libraryState.lastSyncedAt ? new Date(libraryState.lastSyncedAt) : null,
    isSyncing: libraryState.busy, syncProgress: libraryState.progress, downloadError: libraryState.error,
    syncArticles, downloadAllArticles, downloadArticle, getArticle, apiFetch,
    removeDownload: slug => library.removeDownload(slug), clearDownloads: () => library.clearDownloads(),
  }}>{children}</AppContext.Provider>;
}
export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider.');
  return value;
}
