import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Module workers (created with type: "module"): ES output lets the analysis
  // worker load parts lazily (the self-test's reference fixtures).
  worker: { format: "es" },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Quantum Calculator One",
        short_name: "QC-1",
        description: "A pocket quantum calculator: key in gates, watch the state.",
        start_url: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#1f2126",
        theme_color: "#1f2126",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
