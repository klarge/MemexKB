import test from "node:test";
import assert from "node:assert/strict";
import { MEDIA_GRACE_MS, mediaStatus, referencedImageIds } from "../src/lib/media-usage";

test("media references include HTML, infoboxes, diagram previews, JSON escapes and encoded URLs", () => {
  const content = [
    '<img src="/api/articles/images/1">',
    '<div data-image="https://memex.test/root/api/articles/images/2"></div>',
    '<img data-type="drawio" src="/api/articles/images/3">',
    JSON.stringify({ steps: [{ description: '<img src="/api/articles/images/4">' }] }),
    String.raw`{"image":"\/api\/articles\/images\/5"}`,
    String.raw`{"image":"\u002fapi\u002farticles\u002fimages\u002f6"}`,
    '/api/articles/images/%37', '/api/articles/images/&#56;',
    '&sol;api&sol;articles&sol;images&sol;9',
    '/api/articles/images/00010', '/api/articles/images/1',
    '/API/Articles/Images/11', '/api/articles/images/%2B12',
    '/api/articles/images/0xd', '/api/articles/images/%2014tail',
    '/api/articles/images/%C2%A015', '/api/articles/images/16&#128;2',
    '/api/articles/images/%EF%BB%BF17',
    '/api/articles/images/0', '/api/articles/images/999999999999999',
  ].join(" ");
  assert.deepEqual([...referencedImageIds(content)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
});
test("a current reference outranks history and both outrank age; recent/future/invalid dates are protected", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const old = new Date(now.getTime() - MEDIA_GRACE_MS);
  assert.equal(mediaStatus(1, 2, old, now), "current");
  assert.equal(mediaStatus(0, 2, old, now), "history");
  assert.equal(mediaStatus(0, 0, old, now), "unused");
  assert.equal(mediaStatus(0, 0, new Date(old.getTime() + 1), now), "recent");
  assert.equal(mediaStatus(0, 0, new Date(now.getTime() + 100), now), "recent");
  assert.equal(mediaStatus(0, 0, new Date("invalid"), now), "recent");
});
