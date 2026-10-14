import { assetsIn, canonicalServer, documentHtml, documentSearchText } from './content';
import type { CacheScope, CachedArticle, LibraryState, OfflineStore } from './types';

export class SessionExpired extends Error {}
export class Cancelled extends Error {}

const empty = (): LibraryState => ({ articles: [], lastSyncedAt: null, busy: false, progress: null, error: null });

/** All requests are read-only GET/HEAD. Generation/revision checks cover auth transitions,
 * authoritative revocations, and removing a download while it is in flight. */
export class OfflineLibrary {
  state = empty();
  private generation = 0;
  private authority = 0;
  private mutations = 0;
  private revisions = new Map<string, number>();
  private scope: CacheScope | null = null;
  constructor(
    private store: OfflineStore,
    private request: (scope: CacheScope, path: string, method: 'GET' | 'HEAD') => Promise<Response>,
    private changed: (state: LibraryState) => void,
    private unauthorized: () => void,
  ) {}
  private emit(patch: Partial<LibraryState>) {
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  private current(generation: number) { return this.generation === generation && this.scope !== null; }
  async activate(scope: CacheScope | null) {
    const generation = ++this.generation;
    this.authority++;
    this.scope = scope;
    this.revisions.clear();
    this.state = empty();
    this.changed(this.state);
    if (!scope) return;
    const saved = await this.store.load(scope);
    if (this.current(generation)) this.emit(saved);
  }
  private async response(scope: CacheScope, path: string, generation: number, method: 'GET' | 'HEAD' = 'GET') {
    const res = await this.request(scope, path, method);
    if (!this.current(generation)) throw new Cancelled();
    if (res.status === 401) {
      // No fallback to private offline content after confirmed session expiry.
      this.unauthorized();
      throw new SessionExpired('Your session expired. Sign in again to download articles.');
    }
    return res;
  }
  private async save(article: CachedArticle, scope: CacheScope, valid: () => boolean) {
    if (!valid()) throw new Cancelled();
    await this.store.save(scope, article, valid);
    if (!valid()) throw new Cancelled();
    this.emit({ articles: [...this.state.articles.filter(a => a.slug !== article.slug), article] });
  }
  async refresh(downloadAll = false) {
    const scope = this.scope;
    if (!scope || this.state.busy) return;
    const generation = this.generation;
    const valid = () => this.current(generation);
    // A listing is not permission to restore an older snapshot after a detail
    // request revokes access or a user removes a download during storage awaits.
    const mutation = this.mutations;
    const catalogValid = () => valid() && this.mutations === mutation;
    this.emit({ busy: true, error: null, progress: { current: 0, total: 0, phase: 'summaries' } });
    try {
      const summaries: CachedArticle[] = [];
      const seen = new Set<string>();
      let offset = 0, expectedTotal: number | undefined;
      // Stable ID ordering reduces movement between pages. If the collection
      // changes size mid-fetch, abort without pruning any previous downloads.
      while (true) {
        const res = await this.response(scope, `/articles?kind=all&limit=100&offset=${offset}&sort=created_at&order=asc`, generation);
        if (!res.ok) throw new Error(`Article list refresh failed (${res.status}). Saved downloads were kept.`);
        const data = await res.json() as { articles: CachedArticle[]; total: number };
        if (!catalogValid()) throw new Cancelled();
        if (!Array.isArray(data.articles) || !Number.isSafeInteger(data.total) || data.total < 0 ||
          (expectedTotal !== undefined && data.total !== expectedTotal)) throw new Error('The article list changed during refresh. Try again; saved downloads were kept.');
        expectedTotal = data.total;
        for (const article of data.articles) {
          if (!article.slug || !Number.isSafeInteger(article.id) || article.canAccess !== true || seen.has(article.slug)) {
            throw new Error('Incomplete article listing. Saved downloads were kept.');
          }
          seen.add(article.slug);
          summaries.push(article);
        }
        offset += data.articles.length;
        if (offset >= data.total) break;
        if (!data.articles.length) throw new Error('Incomplete article listing. Saved downloads were kept.');
      }
      if (summaries.length !== expectedTotal || !catalogValid()) throw new Cancelled();
      // Only a complete successful listing may prune deleted/revoked records.
      this.authority++;
      const authorizedIds = new Set(summaries.map(a => a.id));
      for (const article of this.state.articles.filter(a => !authorizedIds.has(a.id))) {
        await this.store.remove(scope, article, catalogValid);
        if (!catalogValid()) throw new Cancelled();
        this.emit({ articles: this.state.articles.filter(a => a.id !== article.id) });
      }
      const previous = new Map(this.state.articles.map(a => [a.id, a]));
      const catalog: CachedArticle[] = [];
      for (const summary of summaries) {
        const old = previous.get(summary.id);
        const merged: CachedArticle = {
          ...summary, content: old?.content ?? '', searchText: old?.searchText ?? summary.title.toLowerCase(),
          kind: old?.contentCached ? old.kind ?? 'knowledge' : summary.kind ?? 'knowledge',
          procedureSteps: old?.contentCached ? old.procedureSteps : undefined,
          policySubjectId: old?.contentCached ? old.policySubjectId : summary.policySubjectId,
          contentCached: old?.contentCached ?? false,
          downloadedAt: old?.downloadedAt, downloadComplete: old?.downloadComplete,
          downloadError: old?.downloadError, assetFiles: old?.assetFiles,
          externalAssetCount: old?.externalAssetCount,
          // Keep the downloaded body timestamp distinct from the server version.
          updatedAt: old?.contentCached ? old.updatedAt : summary.updatedAt,
          remoteUpdatedAt: summary.updatedAt,
        };
        await this.store.save(scope, merged, catalogValid);
        if (!catalogValid()) throw new Cancelled();
        catalog.push(merged);
      }
      if (!catalogValid()) throw new Cancelled();
      this.emit({ articles: catalog });
      const targets = catalog.filter(a => downloadAll || a.contentCached);
      const targetRevisions = new Map(targets.map(a => [a.slug, this.revisions.get(a.slug) ?? 0]));
      this.emit({ progress: { current: 0, total: targets.length, phase: 'content' } });
      let failed = 0;
      // Sequential downloads bound memory, database pressure and storage races.
      for (let i = 0; i < targets.length; i++) {
        if ((this.revisions.get(targets[i].slug) ?? 0) !== targetRevisions.get(targets[i].slug)) continue;
        if (targets[i].contentCached && targets[i].downloadComplete &&
          targets[i].updatedAt === targets[i].remoteUpdatedAt && !Object.keys(targets[i].assetFiles ?? {}).length) {
          this.emit({ progress: { current: i + 1, total: targets.length, phase: 'content' } });
          continue;
        }
        try { await this.download(targets[i].slug); }
        catch (error) {
          if (error instanceof Cancelled || error instanceof SessionExpired) throw error;
          failed++;
        }
        if (!valid()) throw new Cancelled();
        this.emit({ progress: { current: i + 1, total: targets.length, phase: 'content' } });
      }
      if (failed) throw new Error(`${failed} article download${failed === 1 ? '' : 's'} incomplete. Previous saved content was kept where available. Retry when connected.`);
      const now = new Date().toISOString();
      await this.store.timestamp(scope, now, valid);
      if (valid()) this.emit({ lastSyncedAt: now });
    } catch (error) {
      if (valid() && !(error instanceof Cancelled)) this.emit({ error: error instanceof Error ? error.message : 'Download interrupted. Saved articles were kept.' });
    } finally {
      if (valid()) this.emit({ busy: false, progress: null });
    }
  }
  async download(slug: string): Promise<CachedArticle | null> {
    const scope = this.scope;
    if (!scope) return null;
    this.mutations++;
    const generation = this.generation, authority = this.authority;
    const revision = (this.revisions.get(slug) ?? 0) + 1;
    this.revisions.set(slug, revision);
    const valid = () => this.current(generation) && this.authority === authority && (this.revisions.get(slug) ?? 0) === revision;
    const previous = this.state.articles.find(a => a.slug === slug);
    let candidate: CachedArticle | undefined;
    const unavailable = new Set<string>();
    try {
      const res = await this.response(scope, `/articles/${encodeURIComponent(slug)}`, generation);
      if (!valid()) throw new Cancelled();
      if (res.status === 403 || res.status === 404) {
        this.mutations++;
        this.revisions.set(slug, revision + 1);
        if (previous) await this.store.remove(scope, previous, () => this.current(generation));
        this.mutations++;
        if (this.current(generation)) this.emit({ articles: this.state.articles.filter(a => a.slug !== slug) });
        return null;
      }
      if (!res.ok) throw new Error(`Article download failed (${res.status}).`);
      const body = await res.json() as CachedArticle;
      if (!valid()) throw new Cancelled();
      if (body.canAccess !== true || body.slug !== slug || !Number.isSafeInteger(body.id) || typeof body.content !== 'string') {
        throw new Error('Invalid article response.');
      }
      if ((body.kind !== undefined && !['knowledge', 'policy', 'procedure'].includes(body.kind)) ||
        (body.kind === 'procedure' && (!Array.isArray(body.procedureSteps) ||
          body.procedureSteps.some(step => !step || typeof step.title !== 'string' || typeof step.description !== 'string')))) {
        throw new Error('Invalid document type or procedure steps.');
      }
      const assets = assetsIn(documentHtml(body), scope.server);
      const files: Record<string, string> = {};
      candidate = { ...body, searchText: documentSearchText(body),
        contentCached: true, downloadedAt: new Date().toISOString(), remoteUpdatedAt: body.updatedAt,
        downloadComplete: false, assetFiles: files, externalAssetCount: assets.external };
      for (const path of assets.paths) {
        // Resume bytes for immutable IDs, but recheck image permission even
        // when its article is unchanged (the image can belong to another article).
        const reusable = previous?.updatedAt === body.updatedAt && previous.content === body.content
          ? previous.assetFiles?.[path] : undefined;
        const assetResponse = await this.response(scope, path.slice(4), generation, reusable ? 'HEAD' : 'GET');
        if (!valid()) throw new Cancelled();
        // The image API deliberately conflates missing and unauthorized images.
        // Remove that image immediately, but only revoke readable article text
        // after checking the article's own authorization.
        if (assetResponse.status === 403 || assetResponse.status === 404) {
          unavailable.add(path);
          await this.store.forgetAsset(scope, body.id, path, valid);
          const retained = previous?.contentCached ? previous : candidate;
          const cleaned = { ...retained, assetFiles: { ...retained.assetFiles }, downloadComplete: false,
            downloadError: 'A referenced image is missing or unavailable. Article text was retained.' };
          delete cleaned.assetFiles[path];
          await this.save(cleaned, scope, valid);
          const confirmation = await this.response(scope, `/articles/${encodeURIComponent(slug)}`, generation);
          if (!valid()) throw new Cancelled();
          if (confirmation.status === 403 || confirmation.status === 404) {
            this.mutations++;
            this.revisions.set(slug, revision + 1);
            await this.store.remove(scope, cleaned, () => this.current(generation));
            this.mutations++;
            if (this.current(generation)) this.emit({ articles: this.state.articles.filter(a => a.slug !== slug), error: 'Article access changed. Its downloaded copy was removed.' });
            throw new Cancelled();
          }
          if (!confirmation.ok) throw new Error('Image unavailable; article access could not be rechecked. Saved text was kept.');
          const checked = await confirmation.json() as CachedArticle;
          if (!valid()) throw new Cancelled();
          if (checked.canAccess !== true || checked.slug !== slug || checked.id !== body.id) throw new Error('Unable to confirm the article response.');
          continue;
        }
        if (!assetResponse.ok) throw new Error(`Image download failed (${assetResponse.status}).`);
        if (assetResponse.url && new URL(assetResponse.url).origin !== new URL(canonicalServer(scope.server)).origin) {
          throw new Error('Image redirect to another server was rejected.');
        }
        const mime = assetResponse.headers.get('content-type')?.split(';')[0].toLowerCase();
        if (!mime || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) throw new Error('Unsupported image format.');
        if (reusable) { files[path] = reusable; continue; }
        if (Number(assetResponse.headers.get('content-length')) > 10 * 1024 * 1024) throw new Error('Image is too large to download.');
        const bytes = new Uint8Array(await assetResponse.arrayBuffer());
        if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Image is too large to download.');
        const isImage = (mime === 'image/png' && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) ||
          (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) ||
          (mime === 'image/gif' && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) ||
          (mime === 'image/webp' && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80);
        if (!isImage) throw new Error('The downloaded image is invalid.');
        files[path] = await this.store.asset(scope, body.id, path, bytes, valid);
      }
      if (unavailable.size) throw new Error('A referenced image is missing or unavailable. Article text was retained.');
      const article: CachedArticle = {
        ...body, searchText: documentSearchText(body),
        contentCached: true, downloadedAt: new Date().toISOString(), remoteUpdatedAt: body.updatedAt,
        downloadComplete: true, downloadError: undefined, assetFiles: files, externalAssetCount: assets.external,
      };
      await this.save(article, scope, valid);
      if (valid()) this.emit({ error: null });
      return article;
    } catch (error) {
      if (valid() && !(error instanceof Cancelled) && !(error instanceof SessionExpired)) {
        const message = error instanceof Error ? error.message : 'Download failed.';
        const retained = unavailable.size && candidate ? candidate : previous?.contentCached ? previous : candidate ?? previous;
        if (retained) {
          const assetFiles = { ...retained.assetFiles };
          unavailable.forEach(path => { delete assetFiles[path]; });
          await this.save({ ...retained, assetFiles, downloadComplete: false, downloadError: message }, scope, valid);
        }
        this.emit({ error: message });
      }
      throw error;
    }
  }
  async removeDownload(slug: string) {
    const scope = this.scope;
    const previous = this.state.articles.find(a => a.slug === slug);
    if (!scope || !previous) return;
    this.mutations++;
    const generation = this.generation;
    this.revisions.set(slug, (this.revisions.get(slug) ?? 0) + 1);
    const valid = () => this.current(generation);
    await this.store.remove(scope, previous, valid);
    this.mutations++;
    if (!valid()) return;
    const removed: CachedArticle = { ...previous, content: '', searchText: previous.title.toLowerCase(), contentCached: false,
      procedureSteps: undefined,
      downloadedAt: undefined, downloadComplete: false, downloadError: undefined, assetFiles: {},
    };
    // Removal has already happened even if persisting the remaining title-only
    // catalog now fails. Never keep displaying a deleted local body.
    this.emit({ articles: this.state.articles.map(a => a.slug === slug ? removed : a) });
    await this.save(removed, scope, valid);
  }
  async clearDownloads() {
    for (const article of [...this.state.articles]) await this.removeDownload(article.slug);
  }
  cached(slug: string) { return this.state.articles.find(a => a.slug === slug && a.contentCached) ?? null; }
}
