import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const driversTable = pgTable("drivers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  vehicleMake: text("vehicle_make").notNull(),
  vehicleModel: text("vehicle_model").notNull(),
  vehicleColor: text("vehicle_color").notNull(),
  vehiclePlate: text("vehicle_plate").notNull(),
  isAvailable: boolean("is_available").notNull().default(false),
  currentLat: real("current_lat"),
  currentLng: real("current_lng"),
  rating: real("rating").notNull().default(5),
  totalTrips: integer("total_trips").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDriverSchema = createInsertSchema(driversTable).omit({ updatedAt: true });
export type InsertDriver = z.infer<typeof insertDriverSchema>;
export type Driver = typeof driversTable.$inferSelect;