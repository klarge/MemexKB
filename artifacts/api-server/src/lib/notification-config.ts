import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const SETTINGS_KEY = "notification_smtp";
export const smtpInputSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(253).refine(v => !/[\s/@:\\]/.test(v), "Enter a hostname, not a URL"),
  port: z.number().int().min(1).max(65535),
  security: z.enum(["starttls", "tls"]),
  username: z.string().trim().max(320),
  password: z.string().max(4096).optional(),
  clearPassword: z.boolean().optional(),
  fromEmail: z.string().trim().max(320),
  fromName: z.string().trim().max(200).refine(v => !/[\r\n]/.test(v)),
  appUrl: z.string().trim().max(2048),
}).superRefine((value, ctx) => {
  if (!value.enabled) return;
  if (!value.host) ctx.addIssue({ code: "custom", path: ["host"], message: "SMTP host is required" });
  if (!z.string().email().safeParse(value.fromEmail).success) ctx.addIssue({ code: "custom", path: ["fromEmail"], message: "A valid sender email is required" });
  try {
    const url = new URL(value.appUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { ctx.addIssue({ code: "custom", path: ["appUrl"], message: "Enter the public http(s) app URL without credentials, query, or fragment" }); }
});
export type StoredSmtp = Omit<z.infer<typeof smtpInputSchema>, "password" | "clearPassword"> & { encryptedPassword?: string };
export const defaultSmtp: StoredSmtp = { enabled: false, host: "", port: 587, security: "starttls", username: "", fromEmail: "", fromName: "", appUrl: "" };

function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for SMTP credential encryption");
  return createHash("sha256").update(`notification-smtp:${secret}`).digest();
}
export function encryptSmtpPassword(password: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64")).join(".");
}
export function decryptSmtpPassword(value: string): string {
  const [iv, tag, ciphertext] = value.split(".").map(part => Buffer.from(part, "base64"));
  if (!iv || !tag || !ciphertext) throw new Error("Invalid SMTP credential");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
export async function readSmtpSettings(): Promise<StoredSmtp> {
  const [row] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, SETTINGS_KEY));
  return row ? { ...defaultSmtp, ...JSON.parse(row.value) } : { ...defaultSmtp };
}
export function publicSmtpSettings(config: StoredSmtp) {
  const { encryptedPassword, ...safe } = config;
  return { ...safe, hasPassword: Boolean(encryptedPassword) };
}
export async function saveSmtpSettings(input: z.infer<typeof smtpInputSchema>) {
  const previous = await readSmtpSettings();
  const { password, clearPassword, ...fields } = input;
  const config: StoredSmtp = {
    ...fields, appUrl: fields.appUrl.replace(/\/+$/, ""),
    encryptedPassword: clearPassword ? undefined : password ? encryptSmtpPassword(password) : previous.encryptedPassword,
  };
  await db.insert(siteSettingsTable).values({ key: SETTINGS_KEY, value: JSON.stringify(config) })
    .onConflictDoUpdate({ target: siteSettingsTable.key, set: { value: JSON.stringify(config) } });
  return config;
}
export function createSmtpTransport(config: StoredSmtp) {
  return nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.security === "tls",
    requireTLS: config.security === "starttls",
    auth: config.username ? { user: config.username, pass: config.encryptedPassword ? decryptSmtpPassword(config.encryptedPassword) : "" } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true,
    tls: { minVersion: "TLSv1.2" },
  });
}
export function smtpErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === "EAUTH") return "SMTP authentication failed. Check the username and password.";
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ECONNREFUSED") return "Unable to connect to the SMTP server. Check the host, port, and network access.";
  if (code === "ESOCKET" || code === "ETLS") return "SMTP secure connection failed. Check the TLS mode and server certificate.";
  return "SMTP delivery failed. Check the saved server and sender settings.";
}
