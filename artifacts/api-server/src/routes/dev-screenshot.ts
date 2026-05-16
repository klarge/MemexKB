import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

if (process.env.NODE_ENV !== "production") {
  router.get("/dev/autologin", async (req, res) => {
    const redirect = (req.query.redirect as string) || "/";
    const [admin] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.role, "admin"))
      .limit(1);
    if (!admin) {
      res.status(503).send("No admin user found");
      return;
    }
    req.session.userId = admin.id;
    req.session.userRole = admin.role;
    req.session.userEmail = admin.email;
    req.session.userName = admin.name;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );
    res.redirect(302, redirect);
  });
}

export default router;
