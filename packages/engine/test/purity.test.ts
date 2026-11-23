import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function allTsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? allTsFilesUnder(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

/** Source without its comments (so a comment may name what the code may not use). */
const code = (file: string): string => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

it('engine source never uses ambient randomness or time', () => {
  const files = allTsFilesUnder(srcDir);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files)
    expect(readFileSync(file, 'utf8')).not.toMatch(/Math\.random|Date\.now|new Date|performance\./);
});

/** Not specified to the last bit, so they differ between JavaScript engines: dmath.ts has deterministic versions. */
const UNSTABLE_MATH = /Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|log(1p|2|10)?|pow|hypot|cbrt|a?(sinh|cosh|tanh))\b|\*\*/;

it('engine source uses only deterministic math (dmath.ts) outside dmath.ts', () => {
  const files = allTsFilesUnder(srcDir).filter((f) => basename(f) !== 'dmath.ts');
  expect(files.length).toBeGreaterThan(10);
  for (const file of files) expect(`${basename(file)}: ${code(file)}`).not.toMatch(UNSTABLE_MATH);
});

it('the purity check catches what it bans', () => {
  expect('const a = Math.exp(1);').toMatch(UNSTABLE_MATH);
  expect('const a = b ** 2;').toMatch(UNSTABLE_MATH);
  expect('x = Math.hypot(a, b, c)').toMatch(UNSTABLE_MATH);
  expect('x = Math.sqrt(a) + Math.abs(b)').not.toMatch(UNSTABLE_MATH);
});
