import { articleImagesTable, db } from "@workspace/db";
import { inArray } from "drizzle-orm";

type ImageAttachmentTransaction = Pick<typeof db, "select" | "update">;

export class ArticleImageAttachmentError extends Error {
  constructor(
    readonly status: 400 | 403,
    message: string,
  ) {
    super(message);
    this.name = "ArticleImageAttachmentError";
  }
}

/**
 * Locks and authorizes every image referenced by article content before
 * associating it with an article. This must be called from the save
 * transaction, after the wikilink advisory lock has been acquired.
 */
export async function attachReferencedArticleImages(
  tx: ImageAttachmentTransaction,
  content: string,
  articleId: number,
  userId: number | undefined,
  userRole: string | undefined,
): Promise<void> {
  const ids = new Set<number>();
  for (const match of content.matchAll(/\/api\/articles\/images\/(\d+)/g)) {
    const id = Number(match[1]);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) {
      throw new ArticleImageAttachmentError(400, "One or more referenced images do not exist");
    }
    ids.add(id);
  }
  const imageIds = [...ids];
  if (imageIds.length === 0) return;

  const images = await tx
    .select({
      id: articleImagesTable.id,
      articleId: articleImagesTable.articleId,
      uploadedById: articleImagesTable.uploadedById,
    })
    .from(articleImagesTable)
    .where(inArray(articleImagesTable.id, imageIds))
    .for("update");

  if (images.length !== imageIds.length) {
    throw new ArticleImageAttachmentError(400, "One or more referenced images do not exist");
  }

  for (const image of images) {
    if (image.articleId !== null && image.articleId !== articleId) {
      throw new ArticleImageAttachmentError(403, "A referenced image is already attached to another article");
    }
    if (userRole !== "admin" && image.uploadedById !== userId) {
      throw new ArticleImageAttachmentError(403, "You can only attach images you uploaded");
    }
  }

  await tx
    .update(articleImagesTable)
    .set({ articleId })
    .where(inArray(articleImagesTable.id, imageIds));
}