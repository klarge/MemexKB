import { Storage } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";

function objectFile(path: string) {
  const match = /^\/([^/]+)\/(.+)$/.exec(path);
  if (!match) throw Error("Invalid App Storage object path");
  const sidecar = "http://127.0.0.1:1106";
  const storage = process.env.REPL_ID ? new Storage({
    projectId: "",
    credentials: {
      audience: "replit", subject_token_type: "access_token", type: "external_account",
      token_url: `${sidecar}/token`,
      credential_source: { url: `${sidecar}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
      universe_domain: "googleapis.com"
    }
  }) : new Storage(); // Standard application-default credentials outside Replit.
  return storage.bucket(match[1]).file(match[2]);
}
export async function putBranding(bytes: Buffer, mime: string) {
  const dir = process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/, "");
  if (dir) {
    const path = `${dir}/branding/${randomUUID()}`;
    await objectFile(path).save(bytes, { resumable: false, metadata: { contentType: mime } });
    return path;
  }
  if (process.env.NODE_ENV === "production") throw Object.assign(Error("Configure App Storage before uploading branding."), { status: 503 });
  // Development/test only. Production never silently stores persistent assets
  // on the ephemeral deployment filesystem.
  const id = randomUUID();
  const local = resolve(process.env.DEV_ASSET_DIR ?? ".data/branding");
  await mkdir(local, { recursive: true });
  await writeFile(resolve(local, id), bytes);
  return `dev:${id}`;
}
export async function getBranding(path: string): Promise<Buffer> {
  if (path.startsWith("dev:")) {
    if (process.env.NODE_ENV === "production" || !/^dev:[0-9a-f-]{36}$/.test(path)) throw Error("Invalid development asset");
    return readFile(resolve(process.env.DEV_ASSET_DIR ?? ".data/branding", path.slice(4)));
  }
  return (await objectFile(path).download())[0];
}
export async function deleteBranding(path: string) {
  if (path.startsWith("dev:") && /^dev:[0-9a-f-]{36}$/.test(path)) {
    if (process.env.NODE_ENV === "production") return;
    await unlink(resolve(process.env.DEV_ASSET_DIR ?? ".data/branding", path.slice(4))).catch(() => undefined);
  } else await objectFile(path).delete({ ignoreNotFound: true });
}
