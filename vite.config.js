import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE is set automatically by the GitHub Actions workflow
// to /<repo-name>/ for GitHub Pages routing
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
})
