import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "/",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Hashed assets in /assets are content-addressed; raise the per-chunk
    // warning since splitting vendor libs naturally pushes a few chunks past
    // 500KB on first build before browser-side compression. Functional impact:
    // none — purely silences a benign Rollup warning.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Function form so we can fan out @radix-ui/* and lucide-react sub-paths
        // into their own cacheable chunks instead of pulling them into
        // index.js. Bundle layout only — no runtime behavior change.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-dom') || /[\\/]node_modules[\\/]react[\\/]/.test(id)) return 'vendor-react'
          if (id.includes('@tanstack/react-query')) return 'vendor-query'
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts'
          if (id.includes('@dnd-kit')) return 'vendor-dnd'
          if (id.includes('framer-motion')) return 'vendor-motion'
          if (id.includes('date-fns')) return 'vendor-dates'
          if (id.includes('lucide-react')) return 'vendor-icons'
          if (id.includes('@radix-ui')) return 'vendor-radix'
          if (id.includes('react-hook-form') || id.includes('@hookform/') || id.includes('zod')) return 'vendor-forms'
          if (id.includes('papaparse')) return 'vendor-csv'
          return undefined
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
