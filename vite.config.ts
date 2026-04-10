import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React — rarely changes, cached long-term
          "vendor-react": ["react", "react-dom"],
          // Routing — stable, cached separately
          "vendor-router": ["react-router-dom"],
          // Data layer — stable, cached separately
          "vendor-query": ["@tanstack/react-query"],
          // Supabase client — stable, cached separately
          "vendor-supabase": ["@supabase/supabase-js"],
          // UI icons — large but stable
          "vendor-icons": ["lucide-react"],
        },
      },
    },
  },
}));
