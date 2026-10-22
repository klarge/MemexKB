import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  root: root + "web",
  plugins: [react(), tailwind()],
  resolve: { alias: {
    "@": root + "web/src",
    "@workspace/api-client-react": root + "shared/client/index.ts"
  } },
  build: { outDir: root + "dist/public", emptyOutDir: true }
});
