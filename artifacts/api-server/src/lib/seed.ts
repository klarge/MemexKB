import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, articlesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export async function runSeed(): Promise<void> {
  // Admin credentials can be overridden via environment variables for self-hosted deployments
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin123456";

  // Create default admin user if it does not exist
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, adminEmail))
    .limit(1);

  if (!existing) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await db.insert(usersTable).values({
      name: "Admin User",
      email: adminEmail,
      passwordHash,
      role: "admin",
    });
    logger.info({ email: adminEmail }, "Seed: created default admin user");
  }

  // Create sample articles if none exist
  const [anyArticle] = await db.select({ id: articlesTable.id }).from(articlesTable).limit(1);
  if (!anyArticle) {
    await db.insert(articlesTable).values([
      {
        slug: "home",
        title: "Home",
        content: "<h2>Welcome to Lexikon</h2><p>Lexikon is a self-hostable wiki-style knowledge base. Create, organize, and share articles with your team.</p><p>Use the editor to write articles with rich formatting, images, and <strong>wikilinks</strong> to connect related content.</p>",
      },
      {
        slug: "getting-started",
        title: "Getting Started",
        content: "<h2>Getting Started</h2><p>Log in as an admin to manage users, groups, and access control.</p><ul><li>Create articles using the editor</li><li>Organize content with group-based access control</li><li>Export and import articles via the admin panel</li></ul>",
      },
      {
        slug: "admin-guide",
        title: "Admin Guide",
        content: "<h2>Admin Guide</h2><p>As an admin you can:</p><ul><li>Manage users and assign roles (admin / editor / user)</li><li>Create groups and control which articles each group can access</li><li>Bulk import and export the knowledge base</li><li>Use the maintenance view to find orphaned or stale articles</li></ul>",
      },
    ]);
    logger.info("Seed: created sample articles");
  }
}
