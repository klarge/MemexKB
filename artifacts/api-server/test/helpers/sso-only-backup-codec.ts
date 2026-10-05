import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

type FixtureBackup = { manifest: { sections: Record<string, { count: number; checksum: string }> }; data: Record<string, any[]> };

/** Tests only: edit encrypted fixture archives and maintain their real integrity checks. */
export function decodeBackup(buffer: Buffer, passphrase: string): FixtureBackup {
  const key = scryptSync(passphrase, buffer.subarray(9, 25), 32);
  const cipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(25, 37));
  cipher.setAuthTag(buffer.subarray(37, 53));
  return JSON.parse(gunzipSync(Buffer.concat([cipher.update(buffer.subarray(53)), cipher.final()])).toString());
}

export function encodeBackup(backup: FixtureBackup, passphrase: string): Buffer {
  for (const [name, rows] of Object.entries(backup.data)) {
    backup.manifest.sections[name] = {
      count: rows.length, checksum: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  const ciphertext = Buffer.concat([cipher.update(gzipSync(JSON.stringify(backup))), cipher.final()]);
  return Buffer.concat([Buffer.from("MEMEXENV"), Buffer.from([1]), salt, iv, cipher.getAuthTag(), ciphertext]);
}