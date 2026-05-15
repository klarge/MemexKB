import { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.session.userRole as string)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

declare module "express-session" {
  interface SessionData {
    userId: number;
    userRole: string;
    userEmail: string;
    userName: string;
  }
}
