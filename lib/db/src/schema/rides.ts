import { createInsertSchema } from "drizzle-zod";
import { integer, pgEnum, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { driversTable } from "./drivers";

export const rideStatusEnum = pgEnum("ride_status", [
  "REQUESTED",
  "SEARCHING",
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
]);

export const ridesTable = pgTable("rides", {
  id: text("id").primaryKey(),
  passengerId: text("passenger_id").notNull().references(() => usersTable.id),
  driverId: text("driver_id").references(() => driversTable.id),
  status: rideStatusEnum("status").notNull().default("REQUESTED"),
  pickup: text("pickup").notNull(),
  dropoff: text("dropoff").notNull(),
  pickupLat: real("pickup_lat").notNull(),
  pickupLng: real("pickup_lng").notNull(),
  dropoffLat: real("dropoff_lat").notNull(),
  dropoffLng: real("dropoff_lng").notNull(),
  distanceKm: real("distance_km").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  estimatedFare: real("estimated_fare").notNull(),
  finalFare: real("final_fare"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertRideSchema = createInsertSchema(ridesTable).omit({
  requestedAt: true,
  acceptedAt: true,
  completedAt: true,
});
export type InsertRide = z.infer<typeof insertRideSchema>;
export type Ride = typeof ridesTable.$inferSelect;