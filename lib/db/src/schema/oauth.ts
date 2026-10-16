import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const oauthClientsTable = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  authMethod: text("auth_method").notNull(),
  secretHash: text("secret_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthGrantsTable = pgTable("oauth_grants", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => oauthClientsTable.id, { onDelete: "cascade" }),
  resource: text("resource").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, table => [index("oauth_grants_user_idx").on(table.userId)]);

export const oauthCodesTable = pgTable("oauth_codes", {
  hash: text("hash").primaryKey(),
  grantId: text("grant_id").notNull().references(() => oauthGrantsTable.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  challenge: text("challenge").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const oauthTokensTable = pgTable("oauth_tokens", {
  hash: text("hash").primaryKey(),
  grantId: text("grant_id").notNull().references(() => oauthGrantsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, table => [index("oauth_tokens_grant_idx").on(table.grantId)]);
