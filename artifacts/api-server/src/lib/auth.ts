import { getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";

export function getAuthenticatedUserId(req: Request): string | null {
  const auth = getAuth(req);
  const claims = auth?.sessionClaims as Record<string, unknown> | undefined;
  const claimUserId = typeof claims?.userId === "string" ? claims.userId : null;
  return claimUserId || auth?.userId || null;
}

export function requireAuthentication(req: Request, res: Response): string | null {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return userId;
}

export async function getLocalUser(clerkId: string): Promise<User | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
  return user ?? null;
}

export async function requireLocalUser(
  req: Request,
  res: Response,
): Promise<User | null> {
  const clerkId = requireAuthentication(req, res);
  if (!clerkId) return null;

  const user = await getLocalUser(clerkId);
  if (!user) {
    res.status(404).json({ error: "Complete your profile before continuing" });
    return null;
  }
  return user;
}

export async function requireAdmin(req: Request, res: Response): Promise<User | null> {
  const user = await requireLocalUser(req, res);
  if (!user) return null;
  if (user.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return user;
}