// Builds extension.zip (the file to upload in the Twitch developer console).
// Usage: EBS_URL=https://ton-serveur.example.com npm run ext:zip
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const url = (process.env.EBS_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');
if (!url.startsWith('https://')) {
  console.error('Indique l\'URL HTTPS de ton serveur : EBS_URL=https://... npm run ext:zip');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'ext-'));
try {
  cpSync(join(root, 'extension'), work, { recursive: true });
  writeFileSync(join(work, 'settings.js'), `window.EBS_URL = ${JSON.stringify(url)};\n`);
  const out = join(root, 'extension.zip');
  rmSync(out, { force: true });
  execFileSync('zip', ['-r', '-q', out, '.'], { cwd: work });
  console.log(`extension.zip créé (serveur : ${url})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
