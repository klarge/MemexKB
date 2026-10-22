import { build } from "esbuild";
await build({
  entryPoints: ["server/index.ts"], outfile: "dist/server.mjs", bundle: true,
  platform: "node", format: "esm", packages: "external",
  alias: { "@workspace/db": "./db/index.ts", "@workspace/api-zod": "./shared/zod/index.ts" }
});
