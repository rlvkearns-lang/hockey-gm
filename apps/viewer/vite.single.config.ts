import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Self-contained pages (all script and style inlined, no network) in dist-single/: the watch page as index.html, and
 * with `--mode skating` the skating test as skating.html (a second run, added beside the first). A single file cannot
 * link to the other, so the watch page hides its link to the skating test here.
 */
export default defineConfig(({ mode }) => {
  const skating = mode === 'skating';
  return {
    plugins: [viteSingleFile()],
    define: { __SKATING_LINK__: 'false' },
    build: { outDir: 'dist-single', emptyOutDir: !skating, rollupOptions: { input: skating ? 'skating.html' : 'index.html' } },
  };
});
