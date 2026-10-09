import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/*
 * Deux constructions à partir du même code :
 *  - l'application Android (Capacitor) : racine « / », aucun service worker ;
 *  - la version web installable (PWA, GitHub Pages) : VITE_PWA=1 et VITE_BASE=/Tsundoku/app/ (voir .github/workflows/pages.yml).
 */
const pwa = process.env.VITE_PWA === "1";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [
    react(),
    ...(pwa ? [VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "logo.png"],
      manifest: {
        name: "Tsundoku",
        short_name: "Tsundoku",
        description: "Ta bibliothèque personnelle : suis tes auteurs, vois ce que tu possèdes et ce qu'il te manque.",
        lang: "fr",
        display: "standalone",
        // Chemins relatifs : valables sous n'importe quelle base (GitHub Pages sert l'app dans un sous-dossier).
        start_url: ".",
        scope: ".",
        background_color: "#f8f3ea",
        theme_color: "#2c323c",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        // L'application entière (code, styles, polices, moteur SQLite) est mise en cache : elle démarre sans réseau.
        globPatterns: ["**/*.{js,css,html,wasm,woff2,woff,png,svg,webmanifest}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true
      }
    })] : [])
  ]
});
