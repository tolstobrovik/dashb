import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The React client lives in ./client and talks to the Express API on :4000.
// In dev, Vite serves the UI on :5173 and proxies /api to the API server.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Long-lived libraries in their own chunks: app updates don't bust
        // the framework cache, and lazy pages share one icons bundle.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          icons: ['lucide-react'],
        },
      },
    },
  },
})
