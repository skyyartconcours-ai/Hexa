/**
 * Test helpers: a small XML well-formedness checker, and a real rasteriser.
 *
 * The checker is cheap enough to run on every mark in every style. The
 * rasteriser is the one that actually matters — librsvg is the parser the
 * render package will use, and markup that only fails at raster time is the
 * whole risk this package carries.
 */

const VOID_OK = new Set<string>(); // SVG has no void elements; all self-close.

export interface XmlProblem {
  message: string;
  at: number;
}

/**
 * Verify `markup` is well-formed XML: balanced tags, quoted attributes, and no
 * unescaped `<` or bare `&` in text content.
 */
export function xmlProblems(markup: string): XmlProblem[] {
  const problems: XmlProblem[] = [];
  const stack: string[] = [];
  let i = 0;

  while (i < markup.length) {
    const lt = markup.indexOf('<', i);

    // Text content up to the next tag.
    const text = markup.slice(i, lt === -1 ? markup.length : lt);
    for (const m of text.matchAll(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#x[0-9a-fA-F]+);)/g)) {
      problems.push({ message: `bare '&' in text content: ${JSON.stringify(text.slice(0, 60))}`, at: i + (m.index ?? 0) });
    }
    if (lt === -1) break;

    if (markup.startsWith('<!--', lt)) {
      const end = markup.indexOf('-->', lt);
      if (end === -1) return [...problems, { message: 'unterminated comment', at: lt }];
      i = end + 3;
      continue;
    }

    const gt = findTagEnd(markup, lt);
    if (gt === -1) return [...problems, { message: 'unterminated tag', at: lt }];
    const raw = markup.slice(lt + 1, gt);

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (open !== name) problems.push({ message: `closing </${name}> but open element is <${open ?? 'nothing'}>`, at: lt });
    } else {
      const selfClosing = raw.endsWith('/');
      const inner = selfClosing ? raw.slice(0, -1) : raw;
      const nameMatch = /^([A-Za-z_][\w.:-]*)/.exec(inner);
      if (!nameMatch) {
        problems.push({ message: `malformed tag <${raw.slice(0, 40)}>`, at: lt });
      } else {
        const name = nameMatch[1]!;
        problems.push(...attributeProblems(inner.slice(name.length), lt));
        if (!selfClosing && !VOID_OK.has(name)) stack.push(name);
      }
    }
    i = gt + 1;
  }

  for (const open of stack) problems.push({ message: `unclosed <${open}>`, at: markup.length });
  return problems;
}

/** Find the `>` that closes a tag, skipping any inside quoted attribute values. */
function findTagEnd(s: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

function attributeProblems(attrText: string, at: number): XmlProblem[] {
  const problems: XmlProblem[] = [];
  const re = /\s+([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let consumed = 0;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(attrText)) !== null) {
    if (m.index !== consumed) {
      problems.push({ message: `unquoted or malformed attribute near ${JSON.stringify(attrText.slice(consumed, consumed + 40))}`, at });
      return problems;
    }
    const name = m[1]!;
    if (seen.has(name)) problems.push({ message: `duplicate attribute ${name}`, at });
    seen.add(name);
    const value = m[3] ?? m[4] ?? '';
    if (/<|&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#x[0-9a-fA-F]+);)/.test(value)) {
      problems.push({ message: `unescaped '<' or bare '&' in attribute ${name}="${value.slice(0, 40)}"`, at });
    }
    consumed = re.lastIndex;
  }
  if (attrText.slice(consumed).trim() !== '') {
    problems.push({ message: `trailing junk in tag: ${JSON.stringify(attrText.slice(consumed, consumed + 40))}`, at });
  }
  return problems;
}

export function assertWellFormed(markup: string, label = 'markup'): void {
  const problems = xmlProblems(markup);
  if (problems.length) {
    throw new Error(`${label} is not well-formed XML:\n  ` + problems.slice(0, 5).map((p) => p.message).join('\n  '));
  }
}

/** Every `id="…"` in the document, in order. */
export function idsIn(markup: string): string[] {
  return [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
}

/** Every `url(#…)` reference in the document. */
export function refsIn(markup: string): string[] {
  return [...markup.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]!);
}
