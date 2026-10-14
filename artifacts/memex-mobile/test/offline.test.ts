import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineLibrary, Cancelled } from '../offline/library';
import { scopeKey, assetsIn, readerHtml, articleLink, canonicalServer, textFromHtml } from '../offline/content';
import type { CacheScope, CachedArticle, OfflineStore } from '../offline/types';

const scope: CacheScope = { server: 'https://memex.test', userId: 1, cookie: 'fixture-cookie' };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const article = (slug = 'guide', content = '<p>Offline searchable text</p>'): CachedArticle => ({
  id: slug === 'guide' ? 1 : 2, slug, title: slug, content, searchText: 'offline searchable text',
  contentCached: true, downloadComplete: true, downloadedAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
  updatedByName: null, isRestricted: false, canAccess: true, tags: [],
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
class MemoryStore implements OfflineStore {
  records = new Map<string, Map<string, CachedArticle>>();
  times = new Map<string, string>();
  removed: string[] = [];
  forgotten: string[] = [];
  bucket(s: CacheScope) {
    const key = scopeKey(s);
    if (!this.records.has(key)) this.records.set(key, new Map());
    return this.records.get(key)!;
  }
  async load(s: CacheScope) { return { articles: [...this.bucket(s).values()].map(a => structuredClone(a)), lastSyncedAt: this.times.get(scopeKey(s)) ?? null }; }
  async save(s: CacheScope, a: CachedArticle, valid: () => boolean) { if (valid()) this.bucket(s).set(a.slug, structuredClone(a)); }
  async remove(s: CacheScope, a: CachedArticle, valid: () => boolean) { if (valid()) { this.removed.push(a.slug); this.bucket(s).delete(a.slug); } }
  async clear(s: CacheScope) { this.records.delete(scopeKey(s)); this.times.delete(scopeKey(s)); }
  async timestamp(s: CacheScope, value: string, valid: () => boolean) { if (valid()) this.times.set(scopeKey(s), value); }
  async asset(_s: CacheScope, id: number, path: string, _bytes: Uint8Array, valid: () => boolean) {
    assert.ok(valid()); return `file:///private/${id}/${path.split('/').pop()}`;
  }
  async forgetAsset(_s: CacheScope, _id: number, path: string, valid: () => boolean) {
    if (valid()) this.forgotten.push(path);
  }
}
async function harness(request: (path: string, method?: string) => Promise<Response>, saved: CachedArticle[] = []) {
  const store = new MemoryStore();
  saved.forEach(a => store.bucket(scope).set(a.slug, structuredClone(a)));
  let unauthorized = 0;
  const library = new OfflineLibrary(store, (_s, path, method) => request(path, method), () => {}, () => {
    unauthorized++; void library.activate(null); void store.clear(scope);
  });
  await library.activate(scope);
  return { store, library, unauthorized: () => unauthorized };
}

test('complete GET-only download persists text/assets and survives a cold offline restart', async () => {
  const calls: string[] = [];
  const body = article('guide', '<p>offline field guide</p><img src="/api/articles/images/1"><img src="https://external.test/x.png">');
  const { library, store } = await harness(async path => {
    calls.push(path);
    if (path.startsWith('/articles?')) return json({ articles: [body], total: 1 });
    if (path === '/articles/guide') return json(body);
    if (path === '/articles/images/1') return new Response(png, { headers: { 'content-type': 'image/png' } });
    throw new Error(`Unexpected request ${path}`);
  });
  await library.refresh(true);
  assert.equal(library.state.error, null);
  assert.ok(library.state.lastSyncedAt);
  assert.equal(library.cached('guide')?.downloadComplete, true);
  assert.equal(library.cached('guide')?.externalAssetCount, 1);
  assert.deepEqual(calls.map(path => path.split('?')[0]), ['/articles', '/articles/guide', '/articles/images/1']);
  const restarted = new OfflineLibrary(store, async () => { throw new Error('airplane mode'); }, () => {}, () => {});
  await restarted.activate(scope);
  assert.ok(restarted.cached('guide')?.searchText.includes('field guide'));
  const html = readerHtml(restarted.cached('guide')!, scope.server);
  assert.match(html, /file:\/\/\/private/);
  assert.doesNotMatch(html, /src="https:\/\/external/);
  assert.match(html, /External image unavailable/);
});

test('failed pagination never prunes cached articles or publishes a successful refresh', async () => {
  const old = article('old');
  const { library, store } = await harness(async path => path.includes('offset=0')
    ? json({ articles: [article('guide')], total: 2 }) : json({}, 503), [old]);
  await library.refresh();
  assert.equal(library.cached('old')?.content, old.content);
  assert.equal(library.state.lastSyncedAt, null);
  assert.match(library.state.error!, /503/);
  assert.deepEqual(store.removed, []);
});

test('changing totals and duplicate pages reject non-authoritative listings', async () => {
  for (const duplicate of [true, false]) {
    const { library, store } = await harness(async path => path.includes('offset=0')
      ? json({ articles: [article('guide')], total: 2 })
      : json({ articles: [article(duplicate ? 'guide' : 'other')], total: duplicate ? 2 : 3 }), [article('old')]);
    await library.refresh();
    assert.ok(library.cached('old'));
    assert.deepEqual(store.removed, []);
    assert.ok(library.state.error);
  }
});

test('a complete empty catalog authoritatively removes deleted/revoked articles', async () => {
  const { library, store } = await harness(async () => json({ articles: [], total: 0 }), [article()]);
  await library.refresh();
  assert.deepEqual(library.state.articles, []);
  assert.deepEqual(store.removed, ['guide']);
});

test('failed image download retains previous text, marks partial and keeps old completion timestamp', async () => {
  const original = article('guide', '<p>old text</p>');
  const { library } = await harness(async path => path.startsWith('/articles?')
    ? json({ articles: [{ ...article(), updatedAt: '2026-01-02T00:00:00Z' }], total: 1 }) : path === '/articles/guide'
      ? json({ ...article('guide', '<p>new text</p><img src="/api/articles/images/1">'), updatedAt: '2026-01-02T00:00:00Z' }) : json({}, 503), [original]);
  await library.refresh();
  assert.equal(library.cached('guide')?.content, original.content);
  assert.equal(library.cached('guide')?.downloadComplete, false);
  assert.match(library.cached('guide')?.downloadError!, /503/);
  assert.equal(library.state.lastSyncedAt, null);
});

test('article and asset authorization failures remove local copies instead of falling back', async () => {
  for (const failure of ['article', 'asset']) {
    let reads = 0;
    const { library, store } = await harness(async path => path === '/articles/guide'
      ? failure === 'article' || ++reads > 1 ? json({}, 404) : json(article('guide', '<img src="/api/articles/images/1">'))
      : json({}, 403), [article()]);
    if (failure === 'asset') await assert.rejects(library.download('guide'), Cancelled);
    else assert.equal(await library.download('guide'), null);
    assert.equal(library.cached('guide'), null);
    assert.equal(store.bucket(scope).size, 0);
  }
});

test('confirmed session expiry clears active identity and its private cache', async () => {
  const { library, store, unauthorized } = await harness(async () => json({}, 401), [article()]);
  await library.refresh();
  assert.equal(unauthorized(), 1);
  assert.equal(library.cached('guide'), null);
  assert.equal(store.bucket(scope).size, 0);
});

test('user/server-scoped caches do not bleed across identical numeric user IDs', async () => {
  const { library, store } = await harness(async () => json({}), [article()]);
  const other = { ...scope, server: 'https://other.test' };
  await library.activate(other);
  assert.equal(library.cached('guide'), null);
  await library.activate({ ...scope, userId: 2 });
  assert.equal(library.cached('guide'), null);
  await library.activate(scope);
  assert.ok(library.cached('guide'));
  await library.activate(null);
  await store.clear(scope);
  await library.activate(scope);
  assert.equal(library.cached('guide'), null);
});

test('changing identity rejects a late article response', async () => {
  let finish!: (response: Response) => void;
  const { library, store } = await harness(() => new Promise(resolve => { finish = resolve; }));
  const pending = library.download('guide');
  await library.activate({ ...scope, userId: 2 });
  finish(json(article()));
  await assert.rejects(pending, Cancelled);
  assert.deepEqual(library.state.articles, []);
  assert.equal(store.bucket(scope).size, 0);
});

test('removing a download invalidates in-flight work without deleting on the server', async () => {
  let finish!: (response: Response) => void;
  const { library, store } = await harness(() => new Promise(resolve => { finish = resolve; }), [article()]);
  const pending = library.download('guide');
  await library.removeDownload('guide');
  finish(json(article()));
  await assert.rejects(pending, Cancelled);
  assert.equal(library.cached('guide'), null);
  assert.equal(store.bucket(scope).get('guide')?.contentCached, false);
});

test('older concurrent downloads cannot overwrite a newer response', async () => {
  let finish!: (response: Response) => void;
  let calls = 0;
  const { library } = await harness(async () => {
    if (++calls === 1) return new Promise(resolve => { finish = resolve; });
    return json(article('guide', '<p>newest</p>'));
  });
  const pending = library.download('guide');
  await library.download('guide');
  finish(json(article('guide', '<p>older</p>')));
  await assert.rejects(pending, Cancelled);
  assert.match(library.cached('guide')!.content, /newest/);
});

test('unsafe image sources are never eligible for credential-bearing requests', () => {
  const result = assetsIn('<img src="https://evil.test/api/articles/images/1"><img src="//evil.test/x"><img src="/api/auth/logout"><img src="file:///private/x"><img src="/api/articles/images/3"><img src="https://memex.test/api/articles/images/4">', scope.server);
  assert.deepEqual(result.paths, ['/api/articles/images/3', '/api/articles/images/4']);
  assert.equal(result.external, 4);
  assert.deepEqual(assetsIn('<div data-image="/api/articles/images/8"></div>', scope.server).paths, ['/api/articles/images/8']);
});

test('invalid image bytes are not advertised as complete downloads', async () => {
  const { library } = await harness(async path => path === '/articles/guide'
    ? json(article('guide', '<img src="/api/articles/images/1">'))
    : new Response('<html>login page</html>', { headers: { 'content-type': 'image/png' } }), [article()]);
  await assert.rejects(library.download('guide'), /invalid/);
  assert.equal(library.cached('guide')?.downloadComplete, false);
});

test('partial first downloads retain readable text and resume already-saved images', async () => {
  const calls: string[] = [];
  let fail = true;
  const body = article('guide', '<p>available partial text</p><img src="/api/articles/images/1"><img src="/api/articles/images/2">');
  const { library } = await harness(async (path, method) => {
    calls.push(`${method} ${path}`);
    if (path === '/articles/guide') return json(body);
    if (path.endsWith('/2') && fail) return json({}, 503);
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  await assert.rejects(library.download('guide'), /503/);
  assert.equal(library.cached('guide')?.downloadComplete, false);
  assert.match(library.cached('guide')!.content, /available partial text/);
  assert.equal(Object.keys(library.cached('guide')!.assetFiles!).length, 1);
  fail = false;
  await library.download('guide');
  assert.equal(library.cached('guide')?.downloadComplete, true);
  assert.equal(calls.filter(path => path === 'GET /articles/images/1').length, 1);
  assert.equal(calls.filter(path => path === 'HEAD /articles/images/1').length, 1);
  assert.equal(library.state.error, null);
});

test('missing or unauthorized images retain independently authorized text, on first and later downloads', async () => {
  for (const status of [403, 404]) for (const hasPrevious of [false, true]) {
    const body = article('guide', '<p>authorized text</p><img src="/api/articles/images/1"><img src="/api/articles/images/2">');
    const previous = { ...body, assetFiles: { '/api/articles/images/1': 'file:///old/private.png' } };
    const { library, store } = await harness(async path => path === '/articles/guide'
      ? json(body) : path.endsWith('/1') ? json({}, status)
        : new Response(png, { headers: { 'content-type': 'image/png' } }), hasPrevious ? [previous] : []);
    await assert.rejects(library.download('guide'), /missing or unavailable/);
    const saved = library.cached('guide')!;
    assert.ok(saved.contentCached);
    assert.match(saved.content, /authorized text/);
    assert.equal(saved.downloadComplete, false);
    assert.equal(saved.assetFiles?.['/api/articles/images/1'], undefined);
    assert.ok(saved.assetFiles?.['/api/articles/images/2']);
    assert.deepEqual(store.removed, []);
    assert.deepEqual(store.forgotten, ['/api/articles/images/1']);
  }
});

test('an unchanged image is reauthorized and an unavailable image is removed from the saved copy', async () => {
  const body = article('guide', '<p>public article</p><img src="/api/articles/images/1">');
  body.assetFiles = { '/api/articles/images/1': 'file:///old/protected.png' };
  const methods: string[] = [];
  const { library } = await harness(async (path, method) => {
    if (path === '/articles/guide') return json(body);
    if (path.startsWith('/articles?')) return json({ articles: [body], total: 1 });
    methods.push(method!);
    return json({}, 404);
  }, [body]);
  await library.refresh();
  assert.deepEqual(methods, ['HEAD']);
  assert.equal(library.cached('guide')?.assetFiles?.['/api/articles/images/1'], undefined);
  assert.match(library.cached('guide')!.content, /public article/);
  assert.equal(library.state.lastSyncedAt, null);
});

test('a replacement article at the same slug cannot inherit the deleted article body', async () => {
  const original = article('guide', '<p>old private contents</p>');
  const replacement = { ...article('guide', ''), id: 91, title: 'Replacement' };
  const { library, store } = await harness(async () => json({ articles: [replacement], total: 1 }), [original]);
  await library.refresh();
  assert.equal(library.state.articles[0].id, 91);
  assert.equal(library.cached('guide'), null);
  assert.doesNotMatch(JSON.stringify(await store.load(scope)), /old private contents/);
});

test('native reader handles infoboxes, wikilinks, citations, media placeholders and base paths', () => {
  const a = article('guide', '<div data-type="infobox" data-title="Facts" data-rows="[{&quot;label&quot;:&quot;Owner&quot;,&quot;value&quot;:&quot;Team&quot;}]" data-image="/api/articles/images/1"></div><p>[[Linked Reference|Read this]]</p><sup><a href="#cite-source-1">[1]</a></sup><p id="cite-source-1">Sources</p><iframe src="https://evil.test"></iframe>');
  a.assetFiles = { '/api/articles/images/1': 'file:///private/1.png' };
  const output = readerHtml(a, scope.server);
  assert.match(output, /<table>/);
  assert.match(output, /Owner/);
  assert.match(output, /file:\/\/\/private\/1.png/);
  assert.match(output, /href="https:\/\/memex.test\/knowledge\/linked-reference"/);
  assert.match(output, /href="#cite-source-1"/);
  assert.match(output, /Interactive content is unavailable/);
  assert.equal(textFromHtml('<p>Hello &amp; <strong>world</strong></p>'), 'Hello & world');
  assert.deepEqual(articleLink('/knowledge/guide#cite-source-1', scope.server), { slug: 'guide', fragment: 'cite-source-1' });
  assert.equal(articleLink('https://evil.test/knowledge/guide', scope.server), null);
  assert.deepEqual(articleLink('/wiki/guide', `${scope.server}/memex`), { slug: 'guide', fragment: '' });
  assert.deepEqual(assetsIn('<img src="/api/articles/images/1">', `${scope.server}/memex`).paths, ['/api/articles/images/1']);
  assert.equal(canonicalServer('HTTPS://MEMEX.TEST///'), scope.server);
  assert.throws(() => canonicalServer('https://name:password@memex.test'));
});
