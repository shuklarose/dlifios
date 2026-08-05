import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxying in dev keeps the app calling the API on its own origin, so local
// work needs no entry in the backend's ALLOWED_ORIGINS. Point API_TARGET at a
// local server when working on the backend too.
const API_TARGET =
  process.env.API_TARGET ?? "https://e12gsb70dq1h63e0hp178smz.157.173.120.29.sslip.io";

const apiRoutes = ["/ask", "/config", "/history", "/account", "/preferences"];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      apiRoutes.map((route) => [route, { target: API_TARGET, changeOrigin: true, secure: true }]),
    ),
  },
});
