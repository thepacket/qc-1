import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/** The Content-Security-Policy value of an nginx header snippet in deploy/ (one source for all servers). */
const cspOf = (file: string) => /Content-Security-Policy "([^"]+)"/.exec(readFileSync(new URL(`./deploy/${file}`, import.meta.url), "utf8"))![1];

/**
 * Dev and preview send the policies production sends: the plot-program host
 * worker always gets its own (its sandbox refuses to run without it, see
 * src/analysis/plotHost.ts); preview also gets the site policy, so a preview
 * build behaves like the deployed one.
 */
function securityHeaders(): Plugin {
  const host = cspOf("plot-host-headers.conf"), site = cspOf("headers.conf");
  const isHost = (url = "") => /plotHost[^/]*$/.test(url.split("?")[0]) || /\/plotHost\.ts\?/.test(url);
  return {
    name: "qc1-security-headers",
    configureServer(server) {
      // The dev server injects same-origin imports into workers: allow those, in dev only.
      const devHost = host.replace("script-src", "script-src 'self'");
      server.middlewares.use((req, res, next) => { if (isHost(req.url)) res.setHeader("Content-Security-Policy", devHost); next(); });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => { res.setHeader("Content-Security-Policy", isHost(req.url) ? host : site); next(); });
    },
  };
}

export default defineConfig({
  // Module workers (created with type: "module"): ES output lets the analysis
  // worker load parts lazily (the self-test's reference fixtures).
  worker: { format: "es" },
  plugins: [
    securityHeaders(),
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
