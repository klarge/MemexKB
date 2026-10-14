// Isolated emulator fixture. No database or real accounts are ever contacted.
const http = require('node:http');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAIAAADBrGu+AAAAWklEQVR4nO3PQQ0AIBDAsDOEEN7494IIHg3JkgnoZp39dcMFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjx2Af5A2mpIXGiAAAAAAElFTkSuQmCC', 'base64');
const common = { kind: 'knowledge', contentCached: false, updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedByName: 'Fixture', canAccess: true, isRestricted: false, tags: [] };
const articles = [
  { ...common, id: 1, slug: 'offline-field-guide', title: 'Offline Field Guide',
    content: '<h2 id="field-heading">Offline reading works</h2><p>FIELD_GUIDE_OFFLINE_BODY</p><p>[[Linked Reference]]</p><img src="/api/articles/images/1" alt="Saved image"><figure data-type="diagram"><img src="/api/articles/images/2" alt="Saved diagram"></figure><table><tr><th>Table heading</th><th>Value</th></tr><tr><td>NATIVE_TABLE_BODY</td><td>Preserved</td></tr></table><div data-type="infobox" data-title="Field facts" data-rows="[{&quot;label&quot;:&quot;Source&quot;,&quot;value&quot;:&quot;Native cache&quot;}]"></div><p><a href="#cite-source-1">[1]</a></p><p id="cite-source-1">CITATION_SOURCE_BODY</p><img src="https://external.invalid/image.png">' },
  { ...common, id: 2, slug: 'linked-reference', title: 'Linked Reference', content: '<p>LINKED_REFERENCE_OFFLINE_BODY</p>' },
  { ...common, id: 3, kind: 'policy', policySubjectId: 1, slug: 'safety-policy', title: 'Safety Policy',
    content: '<p>POLICY_OFFLINE_BODY</p><p><a href="/procedures/safety-procedure">Safety Procedure</a></p>' },
  { ...common, id: 4, kind: 'procedure', slug: 'safety-procedure', title: 'Safety Procedure', content: '<p>PROCEDURE_OFFLINE_BODY</p>',
    procedureSteps: [
      { title: 'Inspect equipment', description: '<p>PROCEDURE_STEP_SEARCH_TOKEN</p><a href="/policies/safety-policy">Safety Policy</a><img src="/api/articles/images/1">' },
      { title: 'Report findings', description: '<p>SECOND_PROCEDURE_STEP</p>' },
    ] },
];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8083');
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/api/healthz') return send({ status: 'ok' });
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    res.setHeader('Set-Cookie', 'connect.sid=offline-fixture; Path=/; HttpOnly; SameSite=Lax');
    return send({ id: 90901, email: 'reader@example.test', name: 'Offline Reader', role: 'user' });
  }
  if (url.pathname === '/api/auth/logout') return send({});
  if (!(req.headers.cookie ?? '').includes('connect.sid=offline-fixture')) return send({ error: 'Unauthorized' }, 401);
  if (url.pathname === '/api/auth/providers') return send([]);
  if (url.pathname === '/api/articles') {
    const filtered = articles.filter(a => url.searchParams.get('kind') === 'all' || a.kind === (url.searchParams.get('kind') ?? 'knowledge'));
    return send({ articles: filtered.map(({ content, procedureSteps, ...rest }) => rest), total: filtered.length });
  }
  if (/^\/api\/articles\/images\/[12]$/.test(url.pathname)) {
    res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(png);
  }
  const article = articles.find(a => url.pathname === `/api/articles/${a.slug}`);
  if (article) return send(article);
  return send({ error: 'Not found' }, 404);
});
server.listen(8083, '127.0.0.1', () => console.log('Offline Android fixture listening on 8083'));
