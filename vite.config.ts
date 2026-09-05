import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { watch: { useFsEvents: false, usePolling: true } },
  define: { 'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify(process.env.BASE_PATH || '') },
  plugins: [vinext()],
});
