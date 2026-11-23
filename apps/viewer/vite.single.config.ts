import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** The watch page as one self-contained file (all script and style inlined, no network): dist-single/index.html. */
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { outDir: 'dist-single', emptyOutDir: true, rollupOptions: { input: 'index.html' } },
});
