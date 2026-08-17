import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  GetDriverProfileResponse,
  ListNearbyDriversQueryParams,
  ListNearbyDriversResponse,
  UpdateDriverAvailabilityBody,
  UpdateDriverAvailabilityResponse,
} from "@workspace/api-zod";
import { db, driversTable, usersTable } from "@workspace/db";
import { requireLocalUser } from "../lib/auth";
import { haversine } from "../lib/ride-data";

const router: IRouter = Router();

function driverView(driver: typeof driversTable.$inferSelect) {
  return {
    id: driver.id,
    userId: driver.userId,
    vehicleMake: driver.vehicleMake,
    vehicleModel: driver.vehicleModel,
    vehicleColor: driver.vehicleColor,
    vehiclePlate: driver.vehiclePlate,
    isAvailable: driver.isAvailable,
    currentLat: driver.currentLat,
    currentLng: driver.currentLng,
    rating: driver.rating,
    totalTrips: driver.totalTrips,
  };
}

router.get("/drivers/me", async (req, res): Promise<void> => {
  const user = await requireLocalUser(req, res);
  if (!user) return;
  if (user.role !== "DRIVER") {
    res.status(403).json({ error: "Driver access required" });
    return;
  }
  const [driver] = await db.select().from(driversTable).where(eq(driversTable.userId, user.id)).limit(1);
  if (!driver) {
    res.status(404).json({ error: "Driver profile not found" });
    return;
  }
  res.json(GetDriverProfileResponse.parse(driverView(driver)));
});

router.patch("/drivers/availability", async (req, res): Promise<void> => {
  const user = await requireLocalUser(req, res);
  if (!user) return;
  if (user.role !== "DRIVER") {
    res.status(403).json({ error: "Driver access required" });
    return;
  }
  const parsed = UpdateDriverAvailabilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [driver] = await db
    .select()
    .from(driversTable)
    .where(eq(driversTable.userId, user.id))
    .limit(1);
  if (!driver) {
    res.status(404).json({ error: "Driver profile not found" });
    return;
  }
  const [updated] = await db
    .update(driversTable)
    .set({
      isAvailable: parsed.data.isAvailable,
      currentLat: parsed.data.currentLat ?? driver.currentLat,
      currentLng: parsed.data.currentLng ?? driver.currentLng,
      updatedAt: new Date(),
    })
    .where(eq(driversTable.id, driver.id))
    .returning();
  res.json(UpdateDriverAvailabilityResponse.parse(driverView(updated)));
});

router.get("/drivers/nearby", async (req, res): Promise<void> => {
  const parsed = ListNearbyDriversQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await db
    .select({ driver: driversTable, name: usersTable.name })
    .from(driversTable)
    .innerJoin(usersTable, eq(driversTable.userId, usersTable.id))
    .where(and(eq(driversTable.isAvailable, true), eq(usersTable.role, "DRIVER")));
  const results = rows
    .filter((row) => row.driver.currentLat != null && row.driver.currentLng != null)
    .map((row) => {
      const distanceKm = haversine(parsed.data.lat, parsed.data.lng, row.driver.currentLat!, row.driver.currentLng!);
      return {
        driver: driverView(row.driver),
        name: row.name,
        distanceKm: Number(distanceKm.toFixed(2)),
        etaMinutes: Math.max(2, Math.round(distanceKm * 3)),
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, parsed.data.limit);
  res.json(ListNearbyDriversResponse.parse(results));
});

export default router;