import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the app works from any GitHub Pages sub-path (user.github.io/repo/).
export default defineConfig({
  base: './',
  plugins: [react()],
});
