import type { Request } from "express";
import type { User } from "@workspace/db";
export async function establishSsoSession(req: Request, user: User) {
  await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  req.session.userRole = user.role;
  req.session.userEmail = user.email;
  req.session.userName = user.name;
  await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}
