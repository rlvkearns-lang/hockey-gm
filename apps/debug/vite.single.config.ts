import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** One self-contained index.html (all script and style inlined, no network) in dist-single/. */
export default defineConfig({ plugins: [viteSingleFile()], build: { outDir: 'dist-single', emptyOutDir: true } });
