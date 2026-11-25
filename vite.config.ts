import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// VITE_BASE lets the same source deploy at a domain root ("/", Firebase
// Hosting or local dev) or under a subpath ("/hookline/" on GitHub Pages).
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? "/",
});
