import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  GetAdminOverviewResponse,
  ListAdminRidesQueryParams,
  ListAdminRidesResponse,
  ListAdminUsersQueryParams,
  ListAdminUsersResponse,
} from "@workspace/api-zod";
import { db, driversTable, ridesTable, usersTable } from "@workspace/db";
import { requireAdmin } from "../lib/auth";
import { listRideViews } from "../lib/ride-data";

const router: IRouter = Router();

router.get("/admin/overview", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const [users, drivers, rides] = await Promise.all([
    db.select().from(usersTable),
    db.select().from(driversTable),
    db.select().from(ridesTable),
  ]);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const ridesToday = rides.filter((ride) => ride.requestedAt >= startOfDay);
  const completedRides = rides.filter((ride) => ride.status === "COMPLETED");
  const ratings = users.filter((user) => user.totalRides > 0).map((user) => user.rating);
  const statusCounts: Record<string, number> = {};
  for (const ride of rides) statusCounts[ride.status] = (statusCounts[ride.status] ?? 0) + 1;
  const overview = {
    totalUsers: users.length,
    totalPassengers: users.filter((user) => user.role === "PASSENGER").length,
    totalDrivers: users.filter((user) => user.role === "DRIVER").length,
    activeDrivers: drivers.filter((driver) => driver.isAvailable).length,
    ridesToday: ridesToday.length,
    completedRides: completedRides.length,
    revenueToday: Number(ridesToday.filter((ride) => ride.status === "COMPLETED").reduce((sum, ride) => sum + (ride.finalFare ?? ride.estimatedFare), 0).toFixed(2)),
    averageRating: ratings.length ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2)) : 5,
    rideStatusCounts: statusCounts,
  };
  res.json(GetAdminOverviewResponse.parse(overview));
});

router.get("/admin/rides", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const query = ListAdminRidesQueryParams.parse(req.query);
  const rides = await listRideViews({ limit: query.limit });
  res.json(ListAdminRidesResponse.parse(rides));
});

router.get("/admin/users", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const query = ListAdminUsersQueryParams.parse(req.query);
  const users = await db
    .select()
    .from(usersTable)
    .where(query.role ? eq(usersTable.role, query.role) : undefined)
    .orderBy(desc(usersTable.createdAt))
    .limit(query.limit);
  res.json(ListAdminUsersResponse.parse(users));
});

export default router;