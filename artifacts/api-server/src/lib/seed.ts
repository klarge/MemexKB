import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, articlesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Bootstrap the database with an initial admin account and sample articles.
 *
 * This function is intentionally opt-in: it only runs when RUN_SEED=true is
 * explicitly set.  In production you MUST supply SEED_ADMIN_EMAIL and a strong
 * SEED_ADMIN_PASSWORD (≥12 chars); the function throws otherwise so the server
 * fails fast rather than creating a guessable default account.
 *
 * Typical first-run command:
 *   RUN_SEED=true SEED_ADMIN_EMAIL=you@company.com SEED_ADMIN_PASSWORD=<strong> node dist/index.js
 */
export async function runSeed(): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";

  // Resolve credentials — production requires explicit env vars
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (isProduction) {
    if (!adminEmail || !adminPassword) {
      throw new Error(
        "Seed aborted: SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in production. " +
          "Set them as environment variables before running with RUN_SEED=true."
      );
    }
    if (adminPassword.length < 12) {
      throw new Error(
        "Seed aborted: SEED_ADMIN_PASSWORD must be at least 12 characters in production."
      );
    }
  }

  const resolvedEmail = adminEmail ?? "admin@example.com";
  const resolvedPassword = adminPassword ?? "admin123456";

  // Create default admin user if one does not already exist
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, resolvedEmail))
    .limit(1);

  if (!existing) {
    const passwordHash = await bcrypt.hash(resolvedPassword, 12);
    await db.insert(usersTable).values({
      name: "Admin User",
      email: resolvedEmail,
      passwordHash,
      role: "admin",
    });
    logger.info({ email: resolvedEmail }, "Seed: created admin user");
  } else {
    logger.info({ email: resolvedEmail }, "Seed: admin user already exists, skipping");
  }

  // Create sample articles if none exist yet
  const [anyArticle] = await db.select({ id: articlesTable.id }).from(articlesTable).limit(1);
  if (!anyArticle) {
    await db.insert(articlesTable).values([
      {
        slug: "home",
        title: "Home",
        content:
          "<h2>Welcome to Memex</h2><p>Memex is a self-hostable wiki-style knowledge base. Create, organize, and share articles with your team.</p><p>Use the editor to write rich articles with images and <strong>wikilinks</strong> to connect related content.</p>",
      },
      {
        slug: "getting-started",
        title: "Getting Started",
        content:
          "<h2>Getting Started</h2><p>Log in as an admin to manage users, groups, and access control.</p><ul><li>Create articles using the editor</li><li>Organize content with group-based access control</li><li>Export and import articles via the admin panel</li></ul>",
      },
      {
        slug: "admin-guide",
        title: "Admin Guide",
        content:
          "<h2>Admin Guide</h2><p>As an admin you can:</p><ul><li>Manage users and assign roles (admin / editor / user)</li><li>Create groups and control which articles each group can access</li><li>Bulk import and export the knowledge base</li><li>Use the maintenance view to find orphaned or stale articles</li></ul>",
      },
    ]);
    logger.info("Seed: created sample articles");
  }
}
