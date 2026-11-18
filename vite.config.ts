import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { aiMiddlewarePlugin } from "./server/aiMiddleware";

// The AI proxy runs inside the Vite dev/preview server, so `npm run dev` is the
// only process needed. The browser never sees the API key.
export default defineConfig({
  plugins: [react(), aiMiddlewarePlugin()],
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 1600 },
  preview: { port: 4173, host: true },
});
