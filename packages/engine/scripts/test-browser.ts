/**
 * `npm run test:browser`: bundles the golden games (test/golden-browser.ts) into a page, plays them in headless
 * Chromium and checks they match the fingerprints Node checks (test/golden-expected.ts) bit for bit.
 * Needs Playwright with Chromium installed where Node can require it.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

type Outcome = { ok: boolean; results: Record<string, unknown>; ms: number; userAgent: string };
/** The little of Playwright this uses (it is installed outside the repo, so its own types may not be resolvable). */
type Tab = {
  on(event: 'pageerror', f: (e: Error) => void): void;
  goto(url: string): Promise<unknown>;
  waitForFunction(f: () => unknown, arg: null, o: { timeout: number }): Promise<{ jsonValue(): Promise<unknown> }>;
};
type Browser = { newPage(): Promise<Tab>; close(): Promise<void> };

const entry = fileURLToPath(new URL('../test/golden-browser.ts', import.meta.url));
const bundle = await build({ entryPoints: [entry], bundle: true, format: 'iife', target: 'es2022', write: false });
const dir = mkdtempSync(join(tmpdir(), 'golden-'));
const page = join(dir, 'golden.html');
writeFileSync(join(dir, 'golden.js'), bundle.outputFiles[0]!.text);
writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>golden</title><script src="golden.js"></script>');

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Browser> } };
const browser = await chromium.launch();
let failed = true;
try {
  const tab = await browser.newPage();
  const errors: string[] = [];
  tab.on('pageerror', (e) => errors.push(e.message));
  await tab.goto(pathToFileURL(page).href);
  const out = await tab.waitForFunction(() => (globalThis as unknown as { __golden?: unknown }).__golden, null, { timeout: 300_000 })
    .then((h) => h.jsonValue()) as Outcome;
  if (errors.length > 0) throw new Error(`page errors: ${errors.join('; ')}`);
  console.log(`${out.userAgent}\n${(out.ms / 3).toFixed(0)} ms per game`);
  console.log(JSON.stringify(out.results, null, 2));
  failed = !out.ok;
  console.log(out.ok ? 'browser golden games match Node: PASS' : 'browser golden games DIFFER from test/golden-expected.ts: FAIL');
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
