import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";
import { offlineBundle } from "./build/offline-bundle";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), sites(), offlineBundle()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
