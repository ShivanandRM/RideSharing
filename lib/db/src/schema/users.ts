import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, pgEnum, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["PASSENGER", "DRIVER", "ADMIN"]);

export const usersTable = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    clerkId: text("clerk_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: userRoleEnum("role").notNull().default("PASSENGER"),
    phone: text("phone"),
    rating: real("rating").notNull().default(5),
    totalRides: integer("total_rides").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clerkIdUnique: uniqueIndex("users_clerk_id_unique").on(table.clerkId),
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
  }),
);

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;