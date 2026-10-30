import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // A cada deploy o service worker novo assume na hora e apaga o cache antigo:
      // quem já tem o app aberto ou instalado recebe a versão nova sem limpar nada
      registerType: 'autoUpdate',
      injectRegister: 'script',
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
      },
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'logo-480.png'],
      manifest: {
        id: '/',
        name: 'Studio 85',
        short_name: 'Studio 85',
        description: 'Agendamento de lavagem e estética automotiva — Studio 85, Porto Alegre',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait',
        categories: ['lifestyle', 'business'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Android recorta o ícone (círculo, gota): este tem margem para o logo não ser cortado
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@autowash/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
