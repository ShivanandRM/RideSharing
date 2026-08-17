import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  AcceptRideParams,
  AcceptRideResponse,
  CancelRideParams,
  CancelRideResponse,
  GetRideParams,
  GetRideResponse,
  ListRidesQueryParams,
  ListRidesResponse,
  RejectRideParams,
  RejectRideResponse,
  RequestRideBody,
  RequestRideResponse,
  UpdateRideStatusBody,
  UpdateRideStatusParams,
  UpdateRideStatusResponse,
} from "@workspace/api-zod";
import { db, driversTable, ridesTable, usersTable } from "@workspace/db";
import { getRideView, listRideViews, findClosestAvailableDriver, estimateTrip } from "../lib/ride-data";
import { requireLocalUser } from "../lib/auth";

const router: IRouter = Router();

router.get("/rides", async (req, res): Promise<void> => {
  const user = await requireLocalUser(req, res);
  if (!user) return;
  const query = ListRidesQueryParams.parse(req.query);
  const rides = await listRideViews({
    passengerId: user.role === "PASSENGER" ? user.id : undefined,
    driverUserId: user.role === "DRIVER" ? user.id : undefined,
    status: query.status,
    limit: query.limit,
  });
  res.json(ListRidesResponse.parse(rides));
});

router.post("/rides", async (req, res): Promise<void> => {
  const user = await requireLocalUser(req, res);
  if (!user) return;
  if (user.role !== "PASSENGER") {
    res.status(403).json({ error: "Only passengers can request rides" });
    return;
  }
  const parsed = RequestRideBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const trip = estimateTrip(
    parsed.data.pickupLat,
    parsed.data.pickupLng,
    parsed.data.dropoffLat,
    parsed.data.dropoffLng,
  );
  const match = await findClosestAvailableDriver(parsed.data.pickupLat, parsed.data.pickupLng);
  const [ride] = await db
    .insert(ridesTable)
    .values({
      id: randomUUID(),
      passengerId: user.id,
      driverId: match?.driver.id ?? null,
      status: match ? "DRIVER_ASSIGNED" : "SEARCHING",
      ...parsed.data,
      ...trip,
    })
    .returning();

  if (!ride) {
    res.status(500).json({ error: "Could not request ride" });
    return;
  }
  const view = await getRideView(ride.id);
  res.status(201).json(RequestRideResponse.parse(view));
});

router.get("/rides/:id", async (req, res): Promise<void> => {
  const user = await requireLocalUser(req, res);
  if (!user) return;
  const params = GetRideParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ride = await getRideView(params.data.id);
  if (!ride) {
    res.status(404).json({ error: "Ride not found" });
    return;
  }
  if (
    user.role !== "ADMIN" &&
    ride.passengerId !== user.id &&
    ride.driverId !== user.id
  ) {
    res.status(403).json({ error: "You cannot view this ride" });
    return;
  }
  res.json(GetRideResponse.parse(ride));
});

router.post("/rides/:id/cancel", async (req, res): Promise<void> => {
  const user = await requireLocalUser(req, res);
  if (!user) return;
  const params = CancelRideParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ride = await getRideView(params.data.id);
  if (!ride) {
    res.status(404).json({ error: "Ride not found" });
    return;
  }
  if (ride.passengerId !== user.id && user.role !== "ADMIN") {
    res.status(403).json({ error: "Only the passenger can cancel this ride" });
    return;
  }
  const [updated] = await db
    .update(ridesTable)
    .set({ status: "CANCELLED" })
    .where(and(eq(ridesTable.id, params.data.id), sql`${ridesTable.status} not in ('COMPLETED', 'CANCELLED')`))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Ride cannot be cancelled in its current state" });
    return;
  }
  const view = await getRideView(updated.id);
  res.json(CancelRideResponse.parse(view));
});

router.post("/rides/:id/accept", async (req, res): Promise<void> => {
  const user = await requireLocalUser(req, res);
  if (!user) return;
  if (user.role !== "DRIVER") {
    res.status(403).json({ error: "Only drivers can accept rides" });
    return;
  }
  const params = AcceptRideParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [driver] = await db.select().from(driversTable).where(eq(driversTable.userId, user.id)).limit(1);
  if (!driver) {
    res.status(404).json({ error: "Driver profile not found" });
    return;
  }
  const [updated] = await db
    .update(ridesTable)
    .set({ status: "DRIVER_ARRIVING", acceptedAt: new Date() })
    .where(and(eq(ridesTable.id, params.data.id), eq(ridesTable.driverId, driver.id), eq(ridesTable.status, "DRIVER_ASSIGNED")))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "This ride is no longer available" });
    return;
  }
  await db.update(driversTable).set({ isAvailable: false, updatedAt: new Date() }).where(eq(driversTable.id, driver.id));
  const view = await getRideView(updated.id);
  res.json(AcceptRideResponse.parse(view));
});

router.post("/rides/:id/reject", async (req, res): Promise<void> => {
  const user = await requireLocalUser(req, res);
  if (!user) return;
  if (user.role !== "DRIVER") {
    res.status(403).json({ error: "Only drivers can reject rides" });
    return;
  }
  const params = RejectRideParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [driver] = await db.select().from(driversTable).where(eq(driversTable.userId, user.id)).limit(1);
  if (!driver) {
    res.status(404).json({ error: "Driver profile not found" });
    return;
  }
  const [updated] = await db
    .update(ridesTable)
    .set({ status: "REJECTED", driverId: null })
    .where(and(eq(ridesTable.id, params.data.id), eq(ridesTable.driverId, driver.id)))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "This ride is no longer assigned to you" });
    return;
  }
  const view = await getRideView(updated.id);
  res.json(RejectRideResponse.parse(view));
});

router.patch("/rides/:id/status", async (req, res): Promise<void> => {
  const user = await requireLocalUser(req, res);
  if (!user) return;
  if (user.role !== "DRIVER") {
    res.status(403).json({ error: "Only drivers can update ride status" });
    return;
  }
  const params = UpdateRideStatusParams.safeParse(req.params);
  const body = UpdateRideStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    const message = params.success ? (body.success ? "Invalid request" : body.error.message) : params.error.message;
    res.status(400).json({ error: message });
    return;
  }
  const [driver] = await db.select().from(driversTable).where(eq(driversTable.userId, user.id)).limit(1);
  if (!driver) {
    res.status(404).json({ error: "Driver profile not found" });
    return;
  }
  const updates = {
    status: body.data.status,
    ...(body.data.status === "COMPLETED" ? { completedAt: new Date(), finalFare: body.data.finalFare ?? undefined } : {}),
  };
  const [updated] = await db
    .update(ridesTable)
    .set(updates)
    .where(and(eq(ridesTable.id, params.data.id), eq(ridesTable.driverId, driver.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Ride not found or not assigned to you" });
    return;
  }
  if (body.data.status === "COMPLETED" || body.data.status === "CANCELLED") {
    await db.update(driversTable).set({ isAvailable: true, totalTrips: body.data.status === "COMPLETED" ? driver.totalTrips + 1 : driver.totalTrips, updatedAt: new Date() }).where(eq(driversTable.id, driver.id));
    if (body.data.status === "COMPLETED") {
      const ride = await getRideView(updated.id);
      if (ride) await db.update(usersTable).set({ totalRides: sql`${usersTable.totalRides} + 1` }).where(eq(usersTable.id, ride.passengerId));
    }
  }
  const view = await getRideView(updated.id);
  res.json(UpdateRideStatusResponse.parse(view));
});

export default router;