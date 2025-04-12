import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migration",
  dbCredentials: {
    url: process.env.DATABASE_URL || "file:./sqlite.db",
  },
  verbose: true,
});
