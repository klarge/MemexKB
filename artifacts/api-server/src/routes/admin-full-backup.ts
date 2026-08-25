import { Router } from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { sql, count } from "drizzle-orm";
import {
  db,
  usersTable,
  passwordResetTokensTable,
  groupsTable,
  groupMembersTable,
  articlesTable,
  articleGroupsTable,
  articleLinksTable,
  articleImagesTable,
  articleVersionsTable,
  tagsTable,
  articleTagsTable,
  templatesTable,
  templateTagsTable,
  taskListsTable,
  tasksTable,
  projectsTable,
  projectGroupsTable,
  boardsTable,
  boardColumnsTable,
  boardCardsTable,
  boardCardMembersTable,
  boardCardCommentsTable,
  ssoConfigsTable,
  siteSettingsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../lib/auth";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});

const MAGIC = Buffer.from("MEMEXENV");
const VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_CIPHERTEXT_BYTES = 100 * 1024 * 1024;
const MAX_PLAINTEXT_BYTES = 200 * 1024 * 1024;
const MAX_ROWS_PER_SECTION = 50_000;
const RESET_TOKEN_DAYS = 7;

const sectionNames = [
  "users", "groups", "groupMembers", "tags", "articles", "articleGroups",
  "articleLinks", "articleImages", "articleVersions", "articleTags", "templates",
  "templateTags", "taskLists", "tasks", "projects", "projectGroups", "boards",
  "boardColumns", "boardCards", "boardCardMembers", "boardCardComments",
  "ssoConfigs", "siteSettings",
] as const;

type SectionName = typeof sectionNames[number];
type BackupData = Record<SectionName, Record<string, unknown>[]>;
type EnvironmentBackup = {
  manifest: {
    format: "memex-environment-backup";
    version: number;
    exportedAt: string;
    sections: Record<SectionName, { count: number; checksum: string }>;
    excluded: string[];
  };
  data: BackupData;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertPassphrase(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length < 12) {
    throw new Error("Use a backup passphrase with at least 12 characters.");
  }
}

function encrypt(payload: EnvironmentBackup, passphrase: string): Buffer {
  const plain = Buffer.from(JSON.stringify(payload));
  if (plain.length > MAX_PLAINTEXT_BYTES) {
    throw new Error("The uncompressed backup exceeds the 200 MB restore limit. Use a database-level backup for this environment.");
  }
  const compressed = gzipSync(plain, { level: 9 });
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, cipher.getAuthTag(), ciphertext]);
}

function decrypt(payload: Buffer, passphrase: string): EnvironmentBackup {
  const headerBytes = MAGIC.length + 1 + SALT_BYTES + IV_BYTES + TAG_BYTES;
  if (payload.length > MAX_CIPHERTEXT_BYTES || payload.length <= headerBytes) {
    throw new Error("The backup file is empty, damaged, or too large.");
  }
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC) || payload[MAGIC.length] !== VERSION) {
    throw new Error("This is not a supported full environment backup.");
  }
  const saltStart = MAGIC.length + 1;
  const ivStart = saltStart + SALT_BYTES;
  const tagStart = ivStart + IV_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  try {
    const key = scryptSync(passphrase, payload.subarray(saltStart, ivStart), 32);
    const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(ivStart, tagStart));
    decipher.setAuthTag(payload.subarray(tagStart, ciphertextStart));
    const compressed = Buffer.concat([decipher.update(payload.subarray(ciphertextStart)), decipher.final()]);
    const plain = gunzipSync(compressed, { maxOutputLength: MAX_PLAINTEXT_BYTES });
    return JSON.parse(plain.toString("utf8")) as EnvironmentBackup;
  } catch {
    throw new Error("The passphrase is incorrect or the backup has been altered.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateBackup(value: unknown): asserts value is EnvironmentBackup {
  if (!isRecord(value) || !isRecord(value.manifest) || !isRecord(value.data)) {
    throw new Error("The encrypted archive does not contain a valid backup manifest.");
  }
  if (value.manifest.format !== "memex-environment-backup" || value.manifest.version !== VERSION) {
    throw new Error("This backup format is not supported by this environment.");
  }
  const manifest = value.manifest as unknown as EnvironmentBackup["manifest"];
  const data = value.data as unknown as BackupData;
  for (const section of sectionNames) {
    const rows = data[section];
    if (!Array.isArray(rows) || rows.length > MAX_ROWS_PER_SECTION || rows.some((row) => !isRecord(row))) {
      throw new Error(`Backup section "${section}" is invalid or exceeds the safety limit.`);
    }
    const expected = manifest.sections?.[section];
    if (!isRecord(expected) || expected.count !== rows.length || expected.checksum !== sha256(JSON.stringify(rows))) {
      throw new Error(`Backup section "${section}" failed its integrity check.`);
    }
  }
}

function restoreDates(row: Record<string, unknown>): Record<string, unknown> {
  const dateFields = new Set([
    "createdAt", "updatedAt", "archivedAt", "completedAt", "dueDate", "expiresAt", "lastUsedAt",
  ]);
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    dateFields.has(key) && typeof value === "string" ? new Date(value) : value,
  ]));
}

function redactSsoConfig(config: unknown): Record<string, string> {
  if (!isRecord(config)) return {};
  return Object.fromEntries(
    Object.entries(config)
      .filter(([key, value]) => !["clientSecret", "idpCert", "privateKey", "certificate"].includes(key) && typeof value === "string")
      .map(([key, value]) => [key, value as string]),
  );
}

async function buildBackup(): Promise<EnvironmentBackup> {
  return db.transaction(async (tx) => {
    const users = await tx.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, role: usersTable.role, ssoProvider: usersTable.ssoProvider, ssoId: usersTable.ssoId, createdAt: usersTable.createdAt, updatedAt: usersTable.updatedAt }).from(usersTable);
    const groups = await tx.select().from(groupsTable);
    const groupMembers = await tx.select().from(groupMembersTable);
    const tags = await tx.select().from(tagsTable);
    const logSlugColumn = await tx.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'articles'
          AND column_name = 'log_slug'
      ) AS "exists"
    `);
    const supportsLogSlug = (logSlugColumn.rows[0] as { exists?: boolean } | undefined)?.exists === true;
    const articles = supportsLogSlug
      ? await tx.select().from(articlesTable)
      : (await tx.select({
          id: articlesTable.id,
          slug: articlesTable.slug,
          title: articlesTable.title,
          content: articlesTable.content,
          isLogEntry: articlesTable.isLogEntry,
          createdById: articlesTable.createdById,
          updatedById: articlesTable.updatedById,
          createdAt: articlesTable.createdAt,
          updatedAt: articlesTable.updatedAt,
        }).from(articlesTable)).map((article) => ({
          ...article,
          logSlug: article.isLogEntry ? article.slug : null,
        }));
    const articleGroups = await tx.select().from(articleGroupsTable);
    const articleLinks = await tx.select().from(articleLinksTable);
    const articleImages = await tx.select().from(articleImagesTable);
    const articleVersions = await tx.select().from(articleVersionsTable);
    const articleTags = await tx.select().from(articleTagsTable);
    const templates = await tx.select().from(templatesTable);
    const templateTags = await tx.select().from(templateTagsTable);
    const taskLists = await tx.select().from(taskListsTable);
    const tasks = await tx.select().from(tasksTable);
    const projects = await tx.select().from(projectsTable);
    const projectGroups = await tx.select().from(projectGroupsTable);
    const boards = await tx.select().from(boardsTable);
    const boardColumns = await tx.select().from(boardColumnsTable);
    const boardCards = await tx.select().from(boardCardsTable);
    const boardCardMembers = await tx.select().from(boardCardMembersTable);
    const boardCardComments = await tx.select().from(boardCardCommentsTable);
    const ssoConfigs = await tx.select().from(ssoConfigsTable);
    const siteSettings = await tx.select().from(siteSettingsTable);
    const data: BackupData = {
      users, groups, groupMembers, tags, articles, articleGroups, articleLinks, articleImages,
      articleVersions, articleTags, templates, templateTags, taskLists, tasks, projects,
      projectGroups, boards, boardColumns, boardCards, boardCardMembers, boardCardComments,
      ssoConfigs: ssoConfigs.map(({ config, enabled: _enabled, ...row }) => ({ ...row, enabled: false, config: redactSsoConfig(config) })),
      siteSettings,
    };
    for (const section of sectionNames) {
      if (data[section].length > MAX_ROWS_PER_SECTION) {
        throw new Error(`The ${section} section exceeds the ${MAX_ROWS_PER_SECTION.toLocaleString()} record backup limit.`);
      }
    }
    const sections = Object.fromEntries(sectionNames.map((section) => [
      section, { count: data[section].length, checksum: sha256(JSON.stringify(data[section])) },
    ])) as EnvironmentBackup["manifest"]["sections"];
    return {
      manifest: {
        format: "memex-environment-backup",
        version: VERSION,
        exportedAt: new Date().toISOString(),
        sections,
        excluded: ["password hashes", "active sessions", "API tokens", "environment and database credentials", "SSO secrets", "edit locks"],
      },
      data,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function hasExistingData(): Promise<boolean> {
  const counts = await Promise.all([
    db.select({ value: count() }).from(usersTable), db.select({ value: count() }).from(groupsTable),
    db.select({ value: count() }).from(tagsTable), db.select({ value: count() }).from(articlesTable),
    db.select({ value: count() }).from(articleImagesTable),
    db.select({ value: count() }).from(templatesTable), db.select({ value: count() }).from(taskListsTable),
    db.select({ value: count() }).from(projectsTable), db.select({ value: count() }).from(ssoConfigsTable),
    db.select({ value: count() }).from(siteSettingsTable),
  ]);
  return counts.some(([result]) => Number(result.value) > 0);
}

function prepareRecoveryTokens(userIds: number[]) {
  const expiresAt = new Date(Date.now() + RESET_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  return userIds.map((userId) => {
    const token = randomBytes(32).toString("base64url");
    return { userId, token, tokenHash: sha256(token), expiresAt };
  });
}

async function resetSerialSequences(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<void> {
  const serialTables = [
    "users", "password_reset_tokens", "groups", "tags", "articles", "article_images",
    "article_versions", "templates", "task_lists", "tasks", "projects", "boards",
    "board_columns", "board_cards", "board_card_comments", "sso_configs",
  ];
  for (const table of serialTables) {
    await tx.execute(sql.raw(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), ` +
      `COALESCE((SELECT MAX(id) FROM "${table}"), 1), ` +
      `(SELECT COUNT(*) > 0 FROM "${table}"))`,
    ));
  }
}

router.post("/admin/full-backup/export", requireAuth, requireRole("admin"), async (req, res): Promise<void> => {
  try {
    assertPassphrase(req.body?.passphrase);
    const backup = await buildBackup();
    const encrypted = encrypt(backup, req.body.passphrase);
    if (encrypted.length > MAX_CIPHERTEXT_BYTES) {
      throw new Error("The encrypted archive exceeds the 100 MB restore limit. Use a database-level backup for this environment.");
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="memex-environment-backup.mex"');
    res.setHeader("Cache-Control", "no-store");
    res.send(encrypted);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not create backup." });
  }
});

router.post("/admin/full-backup/preview", requireAuth, requireRole("admin"), upload.single("file"), async (req, res): Promise<void> => {
  try {
    if (!req.file) throw new Error("Choose a full environment backup file.");
    assertPassphrase(req.body.passphrase);
    const backup = decrypt(req.file.buffer, req.body.passphrase);
    validateBackup(backup);
    res.json({
      exportedAt: backup.manifest.exportedAt,
      sections: backup.manifest.sections,
      excluded: backup.manifest.excluded,
      destinationHasData: await hasExistingData(),
      warning: "A full restore replaces supported application data and signs out every user.",
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not preview backup." });
  }
});

router.post("/admin/full-backup/restore", requireAuth, requireRole("admin"), upload.single("file"), async (req, res): Promise<void> => {
  try {
    if (!req.file) throw new Error("Choose a full environment backup file.");
    assertPassphrase(req.body.passphrase);
    const backup = decrypt(req.file.buffer, req.body.passphrase);
    validateBackup(backup);
    const populated = await hasExistingData();
    if (populated && req.body.mode !== "replace") {
      res.status(409).json({ error: "This environment already has data. Choose replace mode after reviewing the warning." });
      return;
    }
    if (populated && req.body.confirmation !== "RESTORE") {
      res.status(400).json({ error: 'Type RESTORE to confirm replacing this environment.' });
      return;
    }

    const randomPasswordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
    const restoredUserIds = backup.data.users.map((row) => Number(row.id));
    const recoveryTokens = prepareRecoveryTokens(restoredUserIds);
    const users = backup.data.users.map((row) => ({
      ...restoreDates(row), passwordHash: randomPasswordHash, mustResetPassword: true,
      ssoProvider: null, ssoId: null,
    }));
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM user_sessions`);
      await tx.execute(sql`TRUNCATE TABLE users, groups, articles, tags, templates, task_lists, projects, sso_configs, site_settings, password_reset_tokens RESTART IDENTITY CASCADE`);
      await tx.insert(usersTable).values(users as any);
      await tx.insert(groupsTable).values(backup.data.groups.map(restoreDates) as any);
      await tx.insert(groupMembersTable).values(backup.data.groupMembers.map(restoreDates) as any);
      await tx.insert(tagsTable).values(backup.data.tags.map(restoreDates) as any);
      await tx.insert(articlesTable).values(backup.data.articles.map(restoreDates) as any);
      await tx.insert(articleGroupsTable).values(backup.data.articleGroups.map(restoreDates) as any);
      await tx.insert(articleLinksTable).values(backup.data.articleLinks.map(restoreDates) as any);
      await tx.insert(articleImagesTable).values(backup.data.articleImages.map(restoreDates) as any);
      await tx.insert(articleVersionsTable).values(backup.data.articleVersions.map(restoreDates) as any);
      await tx.insert(articleTagsTable).values(backup.data.articleTags.map(restoreDates) as any);
      await tx.insert(templatesTable).values(backup.data.templates.map(restoreDates) as any);
      await tx.insert(templateTagsTable).values(backup.data.templateTags.map(restoreDates) as any);
      await tx.insert(taskListsTable).values(backup.data.taskLists.map(restoreDates) as any);
      await tx.insert(tasksTable).values(backup.data.tasks.map(restoreDates) as any);
      await tx.insert(projectsTable).values(backup.data.projects.map(restoreDates) as any);
      await tx.insert(projectGroupsTable).values(backup.data.projectGroups.map(restoreDates) as any);
      await tx.insert(boardsTable).values(backup.data.boards.map(restoreDates) as any);
      await tx.insert(boardColumnsTable).values(backup.data.boardColumns.map(restoreDates) as any);
      await tx.insert(boardCardsTable).values(backup.data.boardCards.map(restoreDates) as any);
      await tx.insert(boardCardMembersTable).values(backup.data.boardCardMembers.map(restoreDates) as any);
      await tx.insert(boardCardCommentsTable).values(backup.data.boardCardComments.map(restoreDates) as any);
      await tx.insert(ssoConfigsTable).values(backup.data.ssoConfigs.map(restoreDates) as any);
      await tx.insert(siteSettingsTable).values(backup.data.siteSettings.map(restoreDates) as any);
      await tx.insert(passwordResetTokensTable).values(recoveryTokens.map(({ token, ...row }) => row));
      await resetSerialSequences(tx);
    });
    const recoveryLinks = recoveryTokens.map(({ userId, token }) => {
      const user = backup.data.users.find((row) => Number(row.id) === userId);
      return {
        userId,
        name: typeof user?.name === "string" ? user.name : undefined,
        email: typeof user?.email === "string" ? user.email : undefined,
        recoveryUrl: `/reset-password?token=${token}`,
      };
    });
    req.session.destroy(() => undefined);
    res.json({
      restored: Object.fromEntries(sectionNames.map((section) => [section, backup.data[section].length])),
      recoveryLinks,
      warning: "All sessions, API tokens, edit locks, and SSO secrets were intentionally invalidated.",
    });
  } catch (error) {
    req.log.error({ error }, "Full environment restore failed");
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not restore backup." });
  }
});

export default router;