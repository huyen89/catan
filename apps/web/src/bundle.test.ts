import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Bundle guard: @hexhaven/shared holds the zod schemas, so any value import from it pulls zod
 * into the client bundle (~20 kB gzip). The web app may only import its types.
 */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}

describe('bundle guard', () => {
  it('imports only types from @hexhaven/shared', () => {
    const offenders: string[] = [];
    for (const file of sources(join(__dirname))) {
      const text = readFileSync(file, 'utf8');
      const re = /import\s+(type\s+)?[^;]*?from\s+'@hexhaven\/shared'/g;
      for (const m of text.matchAll(re)) if (!m[1]) offenders.push(file);
      if (/import\(\s*'@hexhaven\/shared'\s*\)/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
