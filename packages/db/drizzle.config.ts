import { defineConfig } from "drizzle-kit";

const user = process.env.POSTGRES_USER ?? "postgres";
const password = process.env.POSTGRES_PASSWORD ?? "postgres";
const db = process.env.POSTGRES_DB ?? "ay_armory";
const url =
  process.env.DATABASE_URL ??
  `postgres://${user}:${password}@localhost:5432/${db}`;

export default defineConfig({
  out: "./drizzle",
  schema: "./src/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
});
