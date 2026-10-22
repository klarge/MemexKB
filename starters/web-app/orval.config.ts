import { defineConfig } from "orval";
export default defineConfig({
  client: {
    input: "./openapi.yaml",
    output: {
      target: "./shared/client/generated/api.ts", mode: "split",
      client: "react-query", baseUrl: "/api", clean: true,
      override: {
        fetch: { includeHttpResponseReturnType: false },
        mutator: { path: "./shared/client/custom-fetch.ts", name: "customFetch" }
      }
    }
  },
  zod: {
    input: "./openapi.yaml",
    output: {
      target: "./shared/zod/generated/api.ts", mode: "single", client: "zod",
      override: { zod: { version: 3 } }
    }
  }
});
