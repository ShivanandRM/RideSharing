import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  driversTable,
  ridesTable,
  usersTable,
  type Driver,
  type Ride,
} from "@workspace/db";

const driverUserTable = alias(usersTable, "driver_user");

export type RideView = {
  id: string;
  passengerId: string;
  passengerName: string;
  driverId: string | null;
  driverName: string | null;
  status: Ride["status"];
  pickup: string;
  dropoff: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  distanceKm: number;
  durationMinutes: number;
  estimatedFare: number;
  finalFare: number | null;
  requestedAt: Date;
  acceptedAt: Date | null;
  completedAt: Date | null;
};

function toRideView(row: {
  ride: Ride;
  passenger: { name: string } | null;
  driver: Driver | null;
  driverUser: { name: string } | null;
}): RideView {
  return {
    ...row.ride,
    passengerName: row.passenger?.name ?? "Passenger",
    driverId: row.driver?.userId ?? null,
    driverName: row.driverUser?.name ?? null,
  };
}

export async function getRideView(id: string): Promise<RideView | null> {
  const [row] = await db
    .select({
      ride: ridesTable,
      passenger: { name: usersTable.name },
      driver: driversTable,
      driverUser: { name: driverUserTable.name },
    })
    .from(ridesTable)
    .innerJoin(usersTable, eq(ridesTable.passengerId, usersTable.id))
    .leftJoin(driversTable, eq(ridesTable.driverId, driversTable.id))
    .leftJoin(driverUserTable, eq(driversTable.userId, driverUserTable.id))
    .where(eq(ridesTable.id, id))
    .limit(1);

  return row ? toRideView(row) : null;
}

export async function listRideViews(options: {
  passengerId?: string;
  driverUserId?: string;
  status?: Ride["status"];
  limit: number;
}): Promise<RideView[]> {
  const driverUserCondition = options.driverUserId
    ? eq(driverUserTable.id, options.driverUserId)
    : undefined;
  const conditions = [
    options.passengerId ? eq(ridesTable.passengerId, options.passengerId) : undefined,
    options.status ? eq(ridesTable.status, options.status) : undefined,
    driverUserCondition,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));

  const rows = await db
    .select({
      ride: ridesTable,
      passenger: { name: usersTable.name },
      driver: driversTable,
      driverUser: { name: driverUserTable.name },
    })
    .from(ridesTable)
    .innerJoin(usersTable, eq(ridesTable.passengerId, usersTable.id))
    .leftJoin(driversTable, eq(ridesTable.driverId, driversTable.id))
    .leftJoin(driverUserTable, eq(driversTable.userId, driverUserTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ridesTable.requestedAt))
    .limit(options.limit);

  return rows.map(toRideView);
}

export async function findClosestAvailableDriver(
  pickupLat: number,
  pickupLng: number,
): Promise<{ driver: Driver; distanceKm: number } | null> {
  const rows = await db
    .select({ driver: driversTable })
    .from(driversTable)
    .innerJoin(usersTable, eq(driversTable.userId, usersTable.id))
    .where(and(eq(driversTable.isAvailable, true), eq(usersTable.role, "DRIVER")));

  let closest: { driver: Driver; distanceKm: number } | null = null;
  for (const row of rows) {
    if (row.driver.currentLat == null || row.driver.currentLng == null) continue;
    const distanceKm = haversine(
      pickupLat,
      pickupLng,
      row.driver.currentLat,
      row.driver.currentLng,
    );
    if (!closest || distanceKm < closest.distanceKm) closest = { driver: row.driver, distanceKm };
  }
  return closest;
}

export async function listAvailableDrivers(): Promise<Array<{ driver: Driver; name: string }>> {
  const rows = await db
    .select({ driver: driversTable, name: usersTable.name })
    .from(driversTable)
    .innerJoin(usersTable, eq(driversTable.userId, usersTable.id))
    .where(eq(driversTable.isAvailable, true))
    .orderBy(asc(driversTable.updatedAt));
  return rows;
}

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateTrip(pickupLat: number, pickupLng: number, dropoffLat: number, dropoffLng: number) {
  const straightLineKm = haversine(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const distanceKm = Math.max(1.2, Number((straightLineKm * 1.25).toFixed(1)));
  const durationMinutes = Math.max(6, Math.round(distanceKm * 3.4));
  const estimatedFare = Number((60 + distanceKm * 14 + durationMinutes * 2).toFixed(2));
  return { distanceKm, durationMinutes, estimatedFare };
}