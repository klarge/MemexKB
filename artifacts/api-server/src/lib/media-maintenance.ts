import { createHash } from "node:crypto";
import {
  db, articleImagesTable, articlesTable, usersTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { MEDIA_GRACE_DAYS, mediaStatus, referencedImageIds } from "./media-usage";
import { diagramImageIds } from "./media-diagram-references";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class MediaMaintenanceBusy extends Error {}

/** All saved text surfaces, including archived projects and historical diagrams.
 * Bytes are inspected only for diagram dependencies/fingerprints, never returned
 * by list/preview responses.
 */
export async function inspectMedia(tx: Transaction, now = new Date()) {
  const sources = await tx.execute<{ scope: "current" | "history"; content: string }>(sql`
    SELECT 'current' AS scope, to_jsonb(a)::text AS content FROM articles a
    UNION ALL SELECT 'history', to_jsonb(v)::text FROM article_versions v
    UNION ALL SELECT 'current', to_jsonb(t)::text FROM templates t
    UNION ALL SELECT 'current', to_jsonb(c)::text FROM board_cards c
    UNION ALL SELECT 'current', to_jsonb(c)::text FROM board_card_comments c
    UNION ALL SELECT 'current', to_jsonb(p)::text FROM projects p
    UNION ALL SELECT 'current', to_jsonb(s)::text FROM site_settings s
    UNION ALL SELECT 'current', to_jsonb(t)::text FROM tasks t
    UNION ALL SELECT 'current', to_jsonb(t)::text FROM task_lists t
    UNION ALL SELECT 'current', to_jsonb(p)::text FROM policy_subjects p
  `);
  const counts = new Map<number, { current: number; history: number }>();
  for (const source of sources.rows) {
    for (const id of referencedImageIds(source.content)) {
      const value = counts.get(id) ?? { current: 0, history: 0 };
      value[source.scope]++;
      counts.set(id, value);
    }
  }
  const metadata = await tx.select({
    id: articleImagesTable.id, filename: articleImagesTable.filename,
    mimeType: articleImagesTable.mimeType, createdAt: articleImagesTable.createdAt,
    storedBytes: sql<number>`octet_length(${articleImagesTable.data})`,
    sizeBytes: sql<number>`(length(${articleImagesTable.data}) * 3 / 4 -
      CASE WHEN right(${articleImagesTable.data}, 2) = '==' THEN 2
      WHEN right(${articleImagesTable.data}, 1) = '=' THEN 1 ELSE 0 END)`,
    uploadedByName: usersTable.name,
    articleTitle: articlesTable.title, articleSlug: articlesTable.slug,
  }).from(articleImagesTable)
    .leftJoin(usersTable, eq(articleImagesTable.uploadedById, usersTable.id))
    .leftJoin(articlesTable, eq(articleImagesTable.articleId, articlesTable.id))
    .orderBy(desc(articleImagesTable.createdAt), desc(articleImagesTable.id));
  // Follow image dependencies inside editable diagrams.
  // Read only PNGs containing the mxfile marker, never send their bytes to the UI.
  // Work per scope so history-only diagrams protect history-only dependencies.
  const queue: { id: number; scope: "current" | "history" }[] = [];
  const metadataById = new Map(metadata.map(image => [image.id, image]));
  for (const image of metadata) {
    const refs = counts.get(image.id);
    if (refs?.current || mediaStatus(0, 0, image.createdAt, now) === "recent") queue.push({ id: image.id, scope: "current" });
    if (refs?.history) queue.push({ id: image.id, scope: "history" });
  }
  const visited = new Set<string>();
  const edges = new Map<number, Set<number>>();
  let checkedOrphanSources = false;
  while (queue.length || !checkedOrphanSources) {
    if (!queue.length) {
      checkedOrphanSources = true;
      // An unreferenced diagram is still a stored source until it is deleted.
      // Keep its dependencies for this pass; they may become unused afterward.
      // This also protects children when a changed parent is skipped at cleanup.
      for (const image of metadata) {
        const refs = counts.get(image.id);
        if (!refs?.current && !refs?.history) queue.push({ id: image.id, scope: "current" });
      }
    }
    const batch = queue.splice(0).filter(item => {
      const key = `${item.scope}:${item.id}`;
      if (visited.has(key)) return false;
      visited.add(key);
      return true;
    });
    const unread = [...new Set(batch.map(item => item.id))].filter(id => !edges.has(id));
    if (unread.length) {
      const diagrams = await tx.select({ id: articleImagesTable.id, data: articleImagesTable.data })
        .from(articleImagesTable).where(and(
          inArray(articleImagesTable.id, unread),
          sql`substring(decode(${articleImagesTable.data}, 'base64') from 1 for 8) = decode('89504e470d0a1a0a', 'hex')`,
          sql`position(convert_to('mxfile', 'UTF8') in decode(${articleImagesTable.data}, 'base64')) > 0`,
        ));
      for (const id of unread) edges.set(id, new Set());
      for (const diagram of diagrams) {
        // Invalid legacy diagram source fails closed rather than deleting dependencies.
        edges.set(diagram.id, diagramImageIds(Buffer.from(diagram.data, "base64")));
      }
    }
    for (const item of batch) {
      for (const dependency of edges.get(item.id) ?? []) {
        if (dependency === item.id || !metadataById.has(dependency)) continue;
        const refs = counts.get(dependency) ?? { current: 0, history: 0 };
        refs[item.scope]++;
        counts.set(dependency, refs);
        queue.push({ id: dependency, scope: item.scope });
      }
    }
  }
  const images = metadata.map(image => {
    const refs = counts.get(image.id) ?? { current: 0, history: 0 };
    return {
      ...image, storedBytes: Number(image.storedBytes), sizeBytes: Number(image.sizeBytes),
      createdAt: image.createdAt.toISOString(),
      currentReferences: refs.current, historyReferences: refs.history,
      status: mediaStatus(refs.current, refs.history, image.createdAt, now),
    };
  });
  const summary = {
    total: images.length, current: 0, history: 0, recent: 0, unused: 0,
    totalBytes: 0, unusedBytes: 0, gracePeriodDays: MEDIA_GRACE_DAYS,
  };
  for (const image of images) {
    summary[image.status]++;
    summary.totalBytes += image.storedBytes;
    if (image.status === "unused") summary.unusedBytes += image.storedBytes;
  }
  return { images, summary };
}

type ImageMetadata = Awaited<ReturnType<typeof inspectMedia>>["images"][number];
export type MediaCleanupCandidate = { id: number; fingerprint: string };

function fingerprint(image: ImageMetadata, checksum: string) {
  return createHash("sha256").update(JSON.stringify([
    image.id, image.filename, image.mimeType, image.createdAt, image.storedBytes, checksum,
  ])).digest("hex");
}

export async function fingerprintImages(tx: Transaction, images: ImageMetadata[]): Promise<MediaCleanupCandidate[]> {
  if (!images.length) return [];
  const checksums = await tx.select({
    id: articleImagesTable.id, checksum: sql<string>`md5(${articleImagesTable.data})`,
  }).from(articleImagesTable).where(inArray(articleImagesTable.id, images.map(i => i.id)));
  const byId = new Map(checksums.map(row => [row.id, row.checksum]));
  return images.filter(image => byId.has(image.id)).map(image => ({
    id: image.id, fingerprint: fingerprint(image, byId.get(image.id)!),
  }));
}

/** Block all reference and media writers while rescanning/deleting. NOWAIT
 * fails safely instead of deadlocking with a writer or delaying normal editing.
 * Row locks alone cannot stop a template/card from adding a new reference.
 */
export async function cleanupMedia(candidates: MediaCleanupCandidate[], previewedAt: Date) {
  return db.transaction(async tx => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(824199) AS locked`);
    if (!lock.rows[0]?.locked) throw new MediaMaintenanceBusy();
    await tx.execute(sql`LOCK TABLE articles, article_versions, templates, board_cards,
      board_card_comments, projects, site_settings, tasks, task_lists, policy_subjects,
      article_images IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
    const { images } = await inspectMedia(tx);
    const approved = new Map(candidates.map(c => [c.id, c.fingerprint]));
    // A file newly eligible since preview is not part of the administrator's approval.
    const eligible = images.filter(image => approved.has(image.id) && image.status === "unused" &&
      new Date(image.createdAt).getTime() <= previewedAt.getTime());
    const currentFingerprints = await fingerprintImages(tx, eligible);
    const ids = currentFingerprints.filter(c => approved.get(c.id) === c.fingerprint).map(c => c.id);
    const removed = ids.length ? await tx.delete(articleImagesTable)
      .where(inArray(articleImagesTable.id, ids))
      .returning({ id: articleImagesTable.id }) : [];
    const removedIds = new Set(removed.map(row => row.id));
    return {
      deletedCount: removed.length, skippedCount: candidates.length - removed.length,
      reclaimedBytes: eligible.filter(image => removedIds.has(image.id)).reduce((sum, i) => sum + i.storedBytes, 0),
    };
  });
}
