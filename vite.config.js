import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

// What build is this? Stamped in at build time so the running app can say
// which version it is. Somebody asking "is the new thing live yet?" should be
// able to answer it by looking, not by guessing from whether they can find
// the feature.
const stamp = () => {
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ')
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return `${when} · ${sha}`
  } catch { return when } // a deploy host without git history still gets a date
}

// The React client lives in ./client and talks to the Express API on :4000.
// In dev, Vite serves the UI on :5173 and proxies /api to the API server.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(stamp()) },
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
