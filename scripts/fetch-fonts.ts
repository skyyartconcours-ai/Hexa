/**
 * Fetch the display faces Hexa's typography is designed around.
 *
 * Hexa does not vendor fonts — they are somebody else's work, and vendoring
 * binaries into a source repo ages badly. But without them the effect is worse
 * than "different typeface": text is *measured* against one font and *drawn* in
 * whatever fontconfig substitutes, so headlines clip mid-word. Every face here
 * is SIL Open Font License 1.1, which permits redistribution and bundling, and
 * the licence is downloaded alongside them as OFL requires.
 *
 *   npx tsx scripts/fetch-fonts.ts
 *
 * Offline or behind a restrictive proxy? Download these families by hand from
 * fonts.google.com and drop the .ttf files into assets/fonts/. `hexa doctor`
 * reports which are missing.
 */

import { mkdir, writeFile, readdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const FONT_DIR = join(process.cwd(), 'assets', 'fonts');

/**
 * librsvg resolves families through fontconfig, not through a path we hand it,
 * so a TTF sitting in assets/fonts/ is invisible to the rasteriser. The files
 * have to land somewhere fontconfig scans, and its cache has to be rebuilt.
 * Without this step the fetch appears to succeed and the renders are unchanged.
 */
async function registerWithFontconfig(): Promise<string> {
  const userFontDir = join(homedir(), '.local', 'share', 'fonts');
  await mkdir(userFontDir, { recursive: true });

  const files = (await readdir(FONT_DIR)).filter((f) => f.endsWith('.ttf'));
  for (const f of files) {
    await copyFile(join(FONT_DIR, f), join(userFontDir, f));
  }

  try {
    await run('fc-cache', ['-f']);
    return `registered ${files.length} face(s) with fontconfig via ${userFontDir}`;
  } catch {
    return `copied ${files.length} face(s) to ${userFontDir}, but fc-cache is unavailable — ` +
      'install fontconfig and run `fc-cache -f`, or the rasteriser will substitute a different face';
  }
}

/**
 * The Google Fonts CSS API content-negotiates on User-Agent, and it is fussier
 * than it looks: a modern Chrome string gets WOFF2, and a Chrome/40 string gets
 * WOFF — neither of which fontconfig will load. A bare `Mozilla/5.0` is old
 * enough that the API falls all the way back to TrueType, which is what
 * librsvg actually wants. Verified empirically against the live API.
 */
const LEGACY_UA = 'Mozilla/5.0';

interface FamilySpec {
  /** Google Fonts family name. */
  family: string;
  /** CSS2 `family=` query, including weights/axes. */
  query: string;
  /** Why this face earns its place in the stack. */
  role: string;
}

const FAMILIES: FamilySpec[] = [
  { family: 'Anton', query: 'Anton', role: 'The esports headline staple — heavy, condensed, unapologetic.' },
  { family: 'Bebas Neue', query: 'Bebas+Neue', role: 'All-caps condensed; kickers, team tags, nameplates.' },
  { family: 'Archivo Black', query: 'Archivo+Black', role: 'Heavy grotesque for wide headlines that need weight, not compression.' },
  { family: 'Oswald', query: 'Oswald:wght@400;500;600;700', role: 'Condensed workhorse across several weights.' },
  { family: 'Teko', query: 'Teko:wght@400;500;600;700', role: 'Tall, narrow, gaming-adjacent; stat numerals.' },
  { family: 'Barlow Condensed', query: 'Barlow+Condensed:wght@400;600;800', role: 'Captions and metadata that must stay quiet.' },
  { family: 'Chakra Petch', query: 'Chakra+Petch:wght@500;700', role: 'Technical/angular; draft and analysis layouts.' },
];

const OFL_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/anton/OFL.txt';

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': LEGACY_UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

async function fetchBinary(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'user-agent': LEGACY_UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Pull every `url(...) format('truetype')` out of a Google Fonts CSS payload. */
function extractTtfUrls(css: string): { url: string; weight: string; style: string }[] {
  const out: { url: string; weight: string; style: string }[] = [];
  const blocks = css.split('@font-face').slice(1);
  for (const block of blocks) {
    const url = /url\((https:\/\/[^)]+\.ttf)\)/.exec(block)?.[1];
    if (!url) continue;
    out.push({
      url,
      weight: /font-weight:\s*(\d+)/.exec(block)?.[1] ?? '400',
      style: /font-style:\s*(\w+)/.exec(block)?.[1] ?? 'normal',
    });
  }
  return out;
}

function fileNameFor(family: string, weight: string, style: string): string {
  const base = family.replace(/\s+/g, '');
  const suffix = style === 'italic' ? 'Italic' : '';
  return `${base}-${weight}${suffix}.ttf`;
}

async function main(): Promise<void> {
  await mkdir(FONT_DIR, { recursive: true });
  console.log(`Fetching display faces → ${FONT_DIR}\n`);

  let ok = 0;
  const failures: string[] = [];

  for (const spec of FAMILIES) {
    try {
      const css = await fetchText(`https://fonts.googleapis.com/css2?family=${spec.query}&display=swap`);
      const faces = extractTtfUrls(css);
      if (!faces.length) throw new Error('no TTF urls in CSS response');

      // Deduplicate: variable fonts list one URL under several weights.
      const seen = new Set<string>();
      for (const face of faces) {
        if (seen.has(face.url)) continue;
        seen.add(face.url);
        const bytes = await fetchBinary(face.url);
        // A TrueType file starts with 0x00010000 or 'true'/'ttcf'/'OTTO'.
        const tag = bytes.readUInt32BE(0);
        if (![0x00010000, 0x74727565, 0x74746366, 0x4f54544f].includes(tag)) {
          throw new Error(`downloaded file is not a font (magic 0x${tag.toString(16)})`);
        }
        const name = fileNameFor(spec.family, face.weight, face.style);
        await writeFile(join(FONT_DIR, name), bytes);
        console.log(`  ✓ ${name.padEnd(32)} ${(bytes.length / 1024).toFixed(0)}KB  ${spec.role}`);
        ok++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${spec.family.padEnd(32)} ${message}`);
      failures.push(`${spec.family}: ${message}`);
    }
  }

  // OFL requires the licence travel with the fonts.
  try {
    await writeFile(join(FONT_DIR, 'OFL.txt'), await fetchText(OFL_URL));
    console.log('  ✓ OFL.txt                          (licence — all faces above are SIL OFL 1.1)');
  } catch {
    console.log('  ! OFL.txt could not be fetched — retrieve it from https://openfontlicense.org before redistributing');
  }

  const installed = (await readdir(FONT_DIR)).filter((f) => f.endsWith('.ttf'));
  console.log(`\n${ok} font file(s) fetched · ${installed.length} now present in assets/fonts/`);

  if (installed.length) {
    console.log(`  ${await registerWithFontconfig()}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} family/families failed:\n  ${failures.join('\n  ')}`);
    console.log('Download these manually from fonts.google.com into assets/fonts/.');
  }
  console.log('\nRun `hexa doctor` to confirm Hexa can see them.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
