import assert from "node:assert/strict";
import { test } from "node:test";
import { attachReferencedArticleImages, ArticleImageAttachmentError } from "../src/lib/article-images";
import { sanitizeArticleHtml } from "../src/lib/sanitize";

type Transaction = Parameters<typeof attachReferencedArticleImages>[0];

function imageTransaction(images: Array<{ id: number; articleId: number | null; uploadedById: number }>) {
  let attachedTo: number | null = null;
  let reads = 0;
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => {
            reads++;
            return images;
          },
        }),
      }),
    }),
    update: () => ({
      set: ({ articleId }: { articleId: number }) => ({
        where: async () => { attachedTo = articleId; },
      }),
    }),
  } as unknown as Transaction;
  return { tx, state: () => ({ attachedTo, reads }) };
}

test("entity-encoded image references are authorized against the saved HTML", async () => {
  for (const fragment of [
    "<img src='&#47;api&#47;articles&#47;images&#47;42'>",
    '<div data-type="infobox" data-image="&sol;api&sol;articles&sol;images&sol;42">Info</div>',
  ]) {
    const stored = sanitizeArticleHtml(fragment);
    assert.match(stored, /\/api\/articles\/images\/42/);
    const { tx, state } = imageTransaction([{ id: 42, articleId: 99, uploadedById: 1 }]);
    await assert.rejects(
      attachReferencedArticleImages(tx, stored, 12, 1, "editor"),
      (error: unknown) => error instanceof ArticleImageAttachmentError && error.status === 403,
    );
    assert.equal(state().reads, 1);
    assert.equal(state().attachedTo, null);
  }
});

test("an authorized upload can be attached to its article", async () => {
  const { tx, state } = imageTransaction([{ id: 42, articleId: null, uploadedById: 1 }]);
  await attachReferencedArticleImages(tx, sanitizeArticleHtml('<img src="/api/articles/images/42">'), 12, 1, "editor");
  assert.equal(state().attachedTo, 12);
});