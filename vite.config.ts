import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset paths so the same build works on any static host and inside the Android WebView.
  base: './',
  server: {
    host: true, // reachable from a phone on the LAN (Web Bluetooth needs HTTPS or localhost, though)
  },
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
