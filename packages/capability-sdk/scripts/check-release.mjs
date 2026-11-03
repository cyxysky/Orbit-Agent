#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { tag: { type: 'string' }, publish: { type: 'boolean' } } });
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (values.tag && values.tag !== `v${manifest.version}`) throw new Error(`Tag must match package.json: v${manifest.version}`);
if (manifest.private) throw new Error('This package is private.');
if (values.publish) {
  if (!manifest.license || manifest.license === 'UNLICENSED') throw new Error('Choose a license and add LICENSE before public publication.');
  await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
}
for (const [entry, target] of Object.entries(manifest.exports)) {
  for (const filename of Object.values(typeof target === 'string' ? { default: target } : target)) {
    if (typeof filename !== 'string') continue;
    try { await readFile(new URL('../' + filename.replace(/^\.\//, ''), import.meta.url)); }
    catch { throw new Error(`Missing export ${entry}: ${filename}. Prepare the release package before publishing.`); }
  }
}
for (const filename of Object.values(manifest.bin)) await readFile(new URL('../' + filename, import.meta.url));
await readFile(new URL('../runtime/ui/viewer.html', import.meta.url));
console.log(`Release files verified: ${manifest.name}@${manifest.version} (${fileURLToPath(new URL('../', import.meta.url))})`);
