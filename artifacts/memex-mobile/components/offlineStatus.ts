import type { CachedArticle } from '@/context/AppContext';

export type SaveState = 'none' | 'saved' | 'partial' | 'stale';

export function saveState(a: CachedArticle): SaveState {
  if (!a.contentCached) return 'none';
  if (!a.downloadComplete) return 'partial';
  if (a.remoteUpdatedAt && a.updatedAt && new Date(a.remoteUpdatedAt).getTime() > new Date(a.updatedAt).getTime()) return 'stale';
  return 'saved';
}

export function saveLabel(a: CachedArticle): string {
  switch (saveState(a)) {
    case 'none': return 'Not downloaded';
    case 'partial': return a.downloadError ? 'Partial: ' + a.downloadError : 'Partial download (some images missing)';
    case 'stale': return 'Saved copy is out of date';
    default: return (a.externalAssetCount ?? 0) > 0
      ? `Saved offline (${a.externalAssetCount} external image${a.externalAssetCount === 1 ? '' : 's'} unavailable)`
      : 'Saved offline';
  }
}
