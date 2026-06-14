import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    minify: false,      // Disable minification for human-readable JS
    cssMinify: false,   // Disable minification for human-readable CSS
    rollupOptions: {
      output: {
        // Remove random hash names and force clean names
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/app.[ext]' // This bundles CSS into assets/app.css
      }
    }
  }
});
