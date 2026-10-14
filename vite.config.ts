import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base relativo: o app funciona em qualquer subcaminho (GitHub Pages, Firebase Hosting, etc.)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
