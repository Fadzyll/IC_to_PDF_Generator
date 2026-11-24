import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { seo } from './seo.config.ts'

// https://vite.dev/config/
export default defineConfig({
  // Three pages: the landing page and one per tool (served as /ic-to-pdf and /picture-to-pdf).
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        ic: 'ic-to-pdf.html',
        picture: 'picture-to-pdf.html',
      },
    },
  },
  plugins: [
    react(),
    seo(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'ScanGo PDF',
        short_name: 'ScanGo PDF',
        description: 'Scan your IC or any photos into a PDF. Free, private, and processed entirely on your device.',
        theme_color: '#1f5fd1',
        background_color: '#f4f6fa',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache everything (incl. the lazily-loaded PDF chunk) so it works offline.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Multi-page site: no single-page fallback. Precached pages are matched by clean
        // URL (/ic-to-pdf -> ic-to-pdf.html), so every page still works offline.
        navigateFallback: null,
      },
    }),
  ],
})
