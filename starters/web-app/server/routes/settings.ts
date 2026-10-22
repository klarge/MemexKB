import { Router } from "express";
import multer from "multer";
import { db, siteSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "../lib/auth";
import { putBranding, getBranding, deleteBranding } from "../lib/branding-storage";
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const fields = ["site_name","accent_color","logo_path","logo_mime_type","favicon_path","favicon_mime_type","favicon_version"];
async function values() {
  return new Map((await db.select().from(siteSettingsTable).where(inArray(siteSettingsTable.key, fields))).map(r => [r.key,r.value]));
}
async function set(key: string, value: string) {
  await db.insert(siteSettingsTable).values({ key,value }).onConflictDoUpdate({ target:siteSettingsTable.key, set:{value} });
}
function publicSettings(map: Map<string,string>) {
  return { siteName:map.get("site_name") ?? "My App", accentColor:map.get("accent_color") ?? null,
    hasLogo:map.has("logo_path"), hasFavicon:map.has("favicon_path"),
    faviconMimeType:map.get("favicon_mime_type") ?? null, faviconVersion:map.get("favicon_version") ?? null };
}
router.get("/settings", async (_req,res) => res.json(publicSettings(await values())));
router.get("/admin/settings", requireRole("admin"), async (_req,res) => res.json(publicSettings(await values())));
router.patch("/admin/settings", requireRole("admin"), async (req,res) => {
  const body = z.object({
    siteName: z.string().trim().min(1).max(100).optional(),
    accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional()
  }).strict().parse(req.body);
  if (body.siteName !== undefined) await set("site_name",body.siteName);
  if (body.accentColor !== undefined) await set("accent_color",body.accentColor.toLowerCase());
  res.json({ ok:true });
});
export function validImage(buf: Buffer, mime: string, icon = false) {
  if (mime === "image/png") return buf.length >= 24 && buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === "image/gif") return buf.length >= 13 && /^GIF8[79]a$/.test(buf.subarray(0,6).toString("ascii"));
  if (icon && ["image/x-icon","image/vnd.microsoft.icon","application/ico"].includes(mime)) return buf.length >= 22 && buf.readUInt32LE(0) === 65536 && buf.readUInt16LE(4) > 0;
  if (!icon && mime === "image/jpeg") return buf.length >= 12 && buf[0] === 255 && buf[1] === 216 && buf[2] === 255;
  if (!icon && mime === "image/webp") return buf.length >= 16 && buf.subarray(0,4).toString() === "RIFF" && buf.subarray(8,12).toString() === "WEBP";
  return false;
}
for (const kind of ["logo","favicon"] as const) {
  router.get(`/settings/${kind}`, async (_req,res) => {
    const map = await values(), path = map.get(`${kind}_path`), mime = map.get(`${kind}_mime_type`);
    if (!path || !mime) {
      if (kind === "favicon") res.redirect(307,"/favicon.svg");
      else res.status(404).json({error:"No logo configured"});
      return;
    }
    res.type(mime).set({ "X-Content-Type-Options":"nosniff", "Cache-Control":"no-cache" }).send(await getBranding(path));
  });
  router.post(`/admin/settings/${kind}`, requireRole("admin"), upload.single(kind), async (req,res) => {
    const file = req.file;
    if (!file || !validImage(file.buffer,file.mimetype,kind === "favicon")) { res.status(400).json({error:"Invalid image. SVG is not accepted."}); return; }
    if (kind === "favicon" && file.size > 1024*1024) { res.status(413).json({error:"Favicon must be 1 MB or smaller"}); return; }
    const old = (await values()).get(`${kind}_path`);
    const path = await putBranding(file.buffer,file.mimetype);
    await db.transaction(async tx => {
      const rows = [{key:`${kind}_path`,value:path},{key:`${kind}_mime_type`,value:file.mimetype}];
      if (kind === "favicon") rows.push({key:"favicon_version",value:String(Date.now())});
      for (const row of rows) await tx.insert(siteSettingsTable).values(row).onConflictDoUpdate({target:siteSettingsTable.key,set:{value:row.value}});
    });
    if (old) await deleteBranding(old).catch(() => req.log.warn("Old branding asset cleanup failed"));
    res.json(kind === "logo" ? {hasLogo:true} : {hasFavicon:true});
  });
  router.delete(`/admin/settings/${kind}`, requireRole("admin"), async (_req,res) => {
    const old = (await values()).get(`${kind}_path`);
    await db.delete(siteSettingsTable).where(inArray(siteSettingsTable.key,[`${kind}_path`,`${kind}_mime_type`,`${kind}_version`]));
    if (old) await deleteBranding(old);
    res.json(kind === "logo" ? {hasLogo:false} : {hasFavicon:false});
  });
}
export default router;
