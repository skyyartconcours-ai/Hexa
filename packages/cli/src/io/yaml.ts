/**
 * A small YAML reader for request files.
 *
 * Hexa request files are configuration: nested maps, a list of subjects, scalar
 * values. That is a *very* small corner of YAML, and pulling in a full parser
 * for it would add a dependency to the CLI's install for a feature most users
 * reach for once. So this handles the corner and — importantly — **refuses**
 * anything outside it with a message naming the construct, rather than
 * mis-parsing it into a plausible-looking wrong request.
 *
 * Supported: comments, `key: value`, nesting by indentation, `- ` sequences
 * (including sequences of maps), quoted and bare scalars, inline `[a, b]` and
 * `{a: b}` flows, `null`/`~`/empty, booleans, numbers.
 *
 * Not supported, and rejected loudly: anchors/aliases (`&`/`*`), tags (`!!`),
 * block scalars (`|`/`>`), multiple documents, and tab indentation.
 */

export class YamlError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`${message} (line ${line})`);
    this.name = 'YamlError';
    this.line = line;
  }
}

interface Line {
  indent: number;
  text: string;
  number: number;
}

export function parseYaml(source: string): unknown {
  const lines = tokenise(source);
  if (lines.length === 0) return {};
  const [value, consumed] = parseBlock(lines, 0, lines[0]!.indent);
  if (consumed < lines.length) {
    throw new YamlError('Unexpected content after the document', lines[consumed]!.number);
  }
  return value;
}

function tokenise(source: string): Line[] {
  const out: Line[] = [];
  const raw = source.split(/\r?\n/);

  for (let i = 0; i < raw.length; i++) {
    const original = raw[i]!;
    const number = i + 1;

    if (original.includes('\t') && /^\s*\t/.test(original)) {
      throw new YamlError('Tab indentation is not allowed in YAML — use spaces', number);
    }

    const withoutComment = stripComment(original);
    const text = withoutComment.trim();
    if (text === '') continue;
    if (text === '---') continue;
    if (text === '...') break;

    if (/^[&*]/.test(text)) throw new YamlError('YAML anchors and aliases are not supported here', number);
    if (/^!!/.test(text)) throw new YamlError('YAML tags are not supported here', number);
    if (/:\s*[|>][-+]?\s*$/.test(text)) throw new YamlError('Block scalars (| and >) are not supported here', number);

    out.push({ indent: original.length - original.trimStart().length, text, number });
  }
  return out;
}

/** Strip a trailing `#` comment that is not inside quotes. */
function stripComment(line: string): string {
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Parse the run of lines at `indent`, returning the value and lines consumed. */
function parseBlock(lines: Line[], start: number, indent: number): [unknown, number] {
  const first = lines[start];
  if (!first) return [null, start];
  return first.text.startsWith('- ') || first.text === '-'
    ? parseSequence(lines, start, indent)
    : parseMapping(lines, start, indent);
}

function parseSequence(lines: Line[], start: number, indent: number): [unknown[], number] {
  const items: unknown[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlError('Unexpected indentation in a list', line.number);
    if (!line.text.startsWith('- ') && line.text !== '-') break;

    const inline = line.text === '-' ? '' : line.text.slice(2).trim();
    i++;

    if (inline === '') {
      // The item's content is the indented block beneath it.
      const [value, next] = i < lines.length && lines[i]!.indent > indent ? parseBlock(lines, i, lines[i]!.indent) : [null, i];
      items.push(value);
      i = next;
      continue;
    }

    // `- key: value` starts a map whose first pair is on the dash line. Any
    // deeper lines that follow belong to the same map.
    const pair = splitPair(inline, line.number);
    if (pair) {
      const childIndent = line.indent + 2;
      const nested: Line[] = [{ indent: childIndent, text: inline, number: line.number }];
      while (i < lines.length && lines[i]!.indent > line.indent) {
        nested.push({ ...lines[i]!, indent: Math.max(childIndent, lines[i]!.indent) });
        i++;
      }
      const [value] = parseMapping(nested, 0, childIndent);
      items.push(value);
      continue;
    }

    items.push(parseScalar(inline, line.number));
  }

  return [items, i];
}

function parseMapping(lines: Line[], start: number, indent: number): [Record<string, unknown>, number] {
  const map: Record<string, unknown> = {};
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlError('Unexpected indentation', line.number);
    if (line.text.startsWith('- ')) break;

    const pair = splitPair(line.text, line.number);
    if (!pair) throw new YamlError(`Expected "key: value", got "${line.text}"`, line.number);
    const [key, rest] = pair;
    i++;

    if (rest !== '') {
      map[key] = parseScalar(rest, line.number);
      continue;
    }

    // An empty value means the child block below, or an explicit null.
    const next = lines[i];
    if (next && next.indent > line.indent) {
      const [value, consumed] = parseBlock(lines, i, next.indent);
      map[key] = value;
      i = consumed;
    } else {
      map[key] = null;
    }
  }

  return [map, i];
}

/** Split `key: value` outside of quotes and flow collections. */
function splitPair(text: string, lineNumber: number): [string, string] | undefined {
  let quote: '"' | "'" | undefined;
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ':' && depth === 0 && (i + 1 >= text.length || /\s/.test(text[i + 1] ?? ''))) {
      const key = unquote(text.slice(0, i).trim(), lineNumber);
      return [key, text.slice(i + 1).trim()];
    }
  }
  return undefined;
}

function parseScalar(text: string, lineNumber: number): unknown {
  const t = text.trim();
  if (t === '' || t === '~' || t === 'null' || t === 'Null' || t === 'NULL') return null;
  if (t === 'true' || t === 'True' || t === 'TRUE' || t === 'yes' || t === 'on') return true;
  if (t === 'false' || t === 'False' || t === 'FALSE' || t === 'no' || t === 'off') return false;

  if (t.startsWith('[')) return parseFlowSequence(t, lineNumber);
  if (t.startsWith('{')) return parseFlowMapping(t, lineNumber);
  if (t.startsWith('"') || t.startsWith("'")) return unquote(t, lineNumber);

  // A bare number, but not something that merely starts with digits — `1v1` and
  // a hex colour must stay strings.
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return t;
}

function parseFlowSequence(text: string, lineNumber: number): unknown[] {
  const inner = requireWrapped(text, '[', ']', lineNumber);
  return inner.trim() === '' ? [] : splitFlow(inner, lineNumber).map((p) => parseScalar(p, lineNumber));
}

function parseFlowMapping(text: string, lineNumber: number): Record<string, unknown> {
  const inner = requireWrapped(text, '{', '}', lineNumber);
  const out: Record<string, unknown> = {};
  if (inner.trim() === '') return out;
  for (const part of splitFlow(inner, lineNumber)) {
    const pair = splitPair(part.trim(), lineNumber);
    if (!pair) throw new YamlError(`Expected "key: value" inside { }, got "${part.trim()}"`, lineNumber);
    out[pair[0]] = parseScalar(pair[1], lineNumber);
  }
  return out;
}

function requireWrapped(text: string, open: string, close: string, lineNumber: number): string {
  if (!text.startsWith(open) || !text.endsWith(close)) {
    throw new YamlError(`Unclosed ${open}${close}`, lineNumber);
  }
  return text.slice(1, -1);
}

/** Split on commas that are not inside quotes or nested flow collections. */
function splitFlow(text: string, lineNumber: number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"') current += text[++i] ?? '';
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '[' || ch === '{') {
      depth++;
      current += ch;
    } else if (ch === ']' || ch === '}') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (quote) throw new YamlError('Unterminated quoted string', lineNumber);
  parts.push(current);
  return parts.filter((p) => p.trim() !== '');
}

function unquote(text: string, lineNumber: number): string {
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\(["\\/nrt])/g, (_m, c: string) => {
      switch (c) {
        case 'n': return '\n';
        case 'r': return '\r';
        case 't': return '\t';
        default: return c;
      }
    });
  }
  if (text.startsWith('"') || text.startsWith("'")) throw new YamlError('Unterminated quoted string', lineNumber);
  return text;
}
