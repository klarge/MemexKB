import { db, articleVersionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { versionAction, type VersionContent, type VersionMode } from "./article-version-policy";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Call inside the article mutation transaction, after acquiring its write lock.
 * The current article and its recovery snapshot therefore always commit together.
 */
export async function saveArticleVersion(
  tx: Transaction,
  article: VersionContent & { id: number },
  editorId: number | null,
  mode: VersionMode = "manual",
  now = new Date(),
) {
  const [latest] = await tx.select().from(articleVersionsTable)
    .where(eq(articleVersionsTable.articleId, article.id))
    .orderBy(desc(articleVersionsTable.versionNumber)).limit(1).for("update");
  const action = versionAction(latest, article, editorId, mode, now);
  const snapshot = {
    title: article.title, content: article.content,
    policySubjectId: article.policySubjectId, procedureSteps: article.procedureSteps,
  };
  if (action === "replace") {
    await tx.update(articleVersionsTable).set({ ...snapshot, createdAt: now })
      .where(eq(articleVersionsTable.id, latest.id));
  } else if (action === "seal") {
    await tx.update(articleVersionsTable).set({ autosaveStartedAt: null })
      .where(eq(articleVersionsTable.id, latest.id));
  } else if (action === "insert") {
    await tx.insert(articleVersionsTable).values({
      ...snapshot, articleId: article.id, versionNumber: (latest?.versionNumber ?? 0) + 1,
      createdById: editorId, createdAt: now,
      autosaveStartedAt: mode === "autosave" ? now : null,
    });
  }
  return action;
}
