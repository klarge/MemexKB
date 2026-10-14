export interface CachedTag { id: number; name: string; color: string }
export interface CachedArticle {
  id: number;
  slug: string;
  title: string;
  content: string;
  searchText: string;
  contentCached: boolean;
  tags: CachedTag[];
  updatedAt: string;
  createdAt: string;
  updatedByName: string | null;
  isRestricted: boolean;
  canAccess: boolean;
  downloadedAt?: string;
  remoteUpdatedAt?: string;
  downloadComplete?: boolean;
  downloadError?: string;
  assetFiles?: Record<string, string>;
  externalAssetCount?: number;
}
export interface CacheScope { server: string; userId: number; cookie: string }
export interface SyncProgress {
  current: number;
  total: number;
  phase: 'summaries' | 'content' | 'done';
}
export interface LibraryState {
  articles: CachedArticle[];
  lastSyncedAt: string | null;
  busy: boolean;
  progress: SyncProgress | null;
  error: string | null;
}
export interface OfflineStore {
  load(scope: CacheScope): Promise<{ articles: CachedArticle[]; lastSyncedAt: string | null }>;
  save(scope: CacheScope, article: CachedArticle, current: () => boolean): Promise<void>;
  remove(scope: CacheScope, article: CachedArticle, current: () => boolean): Promise<void>;
  clear(scope: CacheScope): Promise<void>;
  timestamp(scope: CacheScope, value: string, current: () => boolean): Promise<void>;
  asset(scope: CacheScope, articleId: number, path: string, bytes: Uint8Array, current: () => boolean): Promise<string>;
  forgetAsset(scope: CacheScope, articleId: number, path: string, current: () => boolean): Promise<void>;
}
