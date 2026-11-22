import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function allTsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? allTsFilesUnder(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

it('engine source never uses ambient randomness or time', () => {
  const files = allTsFilesUnder(srcDir);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files)
    expect(readFileSync(file, 'utf8')).not.toMatch(/Math\.random|Date\.now|new Date|performance\./);
});
