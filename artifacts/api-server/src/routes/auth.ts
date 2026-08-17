import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { CreateCurrentUserProfileBody, CreateCurrentUserProfileResponse, GetCurrentUserResponse } from "@workspace/api-zod";
import { db, driversTable, usersTable } from "@workspace/db";
import { getLocalUser, requireAuthentication } from "../lib/auth";

const router: IRouter = Router();

function isAllowedAdmin(email: string): boolean {
  const allowlist = (process.env.ADMIN_EMAILS ?? "admin@rideflow.app")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}

router.get("/auth/me", async (req, res): Promise<void> => {
  const clerkId = requireAuthentication(req, res);
  if (!clerkId) return;
  const user = await getLocalUser(clerkId);
  if (!user) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(GetCurrentUserResponse.parse(user));
});

router.post("/auth/me", async (req, res): Promise<void> => {
  const clerkId = requireAuthentication(req, res);
  if (!clerkId) return;
  const parsed = CreateCurrentUserProfileBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.flatten() }, "Invalid profile request");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const email = parsed.data.email.toLowerCase();
  const role =
    parsed.data.role === "ADMIN" && isAllowedAdmin(email)
      ? "ADMIN"
      : parsed.data.role === "ADMIN"
        ? "PASSENGER"
        : parsed.data.role;
  const existing = await getLocalUser(clerkId);
  let user;

  if (existing) {
    [user] = await db
      .update(usersTable)
      .set({
        name: parsed.data.name,
        email,
        phone: parsed.data.phone ?? null,
        role: existing.role === "ADMIN" ? "ADMIN" : role,
      })
      .where(eq(usersTable.id, existing.id))
      .returning();
  } else {
    [user] = await db
      .insert(usersTable)
      .values({
        id: randomUUID(),
        clerkId,
        name: parsed.data.name,
        email,
        role,
        phone: parsed.data.phone ?? null,
      })
      .returning();
  }

  if (!user) {
    res.status(500).json({ error: "Could not create profile" });
    return;
  }

  if (user.role === "DRIVER") {
    const [driver] = await db.select().from(driversTable).where(eq(driversTable.userId, user.id)).limit(1);
    const vehicle = {
      vehicleMake: parsed.data.vehicleMake || "Campus",
      vehicleModel: parsed.data.vehicleModel || "Hatchback",
      vehicleColor: parsed.data.vehicleColor || "Silver",
      vehiclePlate: parsed.data.vehiclePlate || "RIDE-101",
    };
    if (driver) {
      await db.update(driversTable).set(vehicle).where(eq(driversTable.id, driver.id));
    } else {
      await db.insert(driversTable).values({ id: randomUUID(), userId: user.id, ...vehicle });
    }
  }

  res.json(CreateCurrentUserProfileResponse.parse(user));
});

export default router;