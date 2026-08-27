import { defineConfig } from "playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
});