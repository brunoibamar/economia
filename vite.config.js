import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        id: './',
        name: 'Mi Economía',
        short_name: 'Economía',
        description: 'Ingresos, gastos y tu dinero personal',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#101820',
        theme_color: '#101c26',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
