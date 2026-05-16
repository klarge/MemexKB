import { defineConfig } from "drizzle-kit";
import path from "path";

// DATABASE_URL is required for push/pull but not for generate.
const url = process.env.DATABASE_URL ?? "postgresql://localhost:5432/lexikon";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "./migrations"),
  dialect: "postgresql",
  dbCredentials: { url },
});
