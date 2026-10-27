import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { textagePlugin } from "./server/textage-api.mjs";

export default defineConfig({
  // The same read-only TexTage API is available in dev and preview mode.
  base: "./",
  plugins: [react(), textagePlugin()],
});
