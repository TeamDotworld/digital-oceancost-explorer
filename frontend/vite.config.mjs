import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Keep the REACT_APP_ prefix from Create React App so existing .env files keep working
  envPrefix: ['VITE_', 'REACT_APP_'],
  server: {
    port: 3000
  },
  preview: {
    port: 3000
  },
  build: {
    // Same output folder as Create React App, which the Dockerfile copies from
    outDir: 'build',
    // The large chunks (exceljs, jsPDF, html2canvas) are only loaded when an export button is clicked
    chunkSizeWarningLimit: 1000
  }
});
