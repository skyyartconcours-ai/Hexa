/**
 * The file readers.
 *
 * Both are hand-written, so both are tested hard — particularly the cases that
 * a naive implementation gets *silently* wrong: quoted commas in a CSV title,
 * a `#` inside a YAML string, and a hex colour that must not become a number.
 */

import { describe, expect, it } from 'vitest';
import { isHexaError, type HexaError } from '@hexa/core';
import { parseCsv, parseCsvRows } from './csv.js';
import { YamlError, parseYaml } from './yaml.js';
import { formatOf } from './request-file.js';

describe('parseCsv', () => {
  it('reads a simple table', () => {
    expect(parseCsv('left,right,title\nPeyz,Viper,RIVALS')).toEqual([
      { left: 'Peyz', right: 'Viper', title: 'RIVALS' },
    ]);
  });

  it('keeps a comma inside a quoted field', () => {
    const rows = parseCsv('left,right,title\nFaker,Chovy,"THE CLASSIC, AGAIN"');
    expect(rows[0]?.['title']).toBe('THE CLASSIC, AGAIN');
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('title\n"He said ""go"""')[0]?.['title']).toBe('He said "go"');
  });

  it('keeps a newline inside a quoted field', () => {
    const rows = parseCsv('title\n"line one\nline two"');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['title']).toBe('line one\nline two');
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([{ a: '1', b: '2' }]);
  });

  it('strips a UTF-8 BOM from the first header', () => {
    // Excel writes one, and it would otherwise become part of the column name.
    expect(Object.keys(parseCsv('\uFEFFleft,right\nA,B')[0] ?? {})).toEqual(['left', 'right']);
  });

  it('ignores a trailing newline rather than emitting an empty row', () => {
    expect(parseCsv('a\n1\n')).toHaveLength(1);
  });

  it('pads a short row instead of dropping the columns', () => {
    expect(parseCsv('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('supports tab-separated input', () => {
    expect(parseCsv('a\tb\n1\t2', { delimiter: '\t' })).toEqual([{ a: '1', b: '2' }]);
  });

  it('returns raw rows when asked', () => {
    expect(parseCsvRows('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseYaml', () => {
  it('reads a request document', () => {
    const yaml = `
templateId: versus-classic
subjects:
  - player: Peyz
  - player: Viper
text:
  headline: RIVALS
output:
  dir: ./out
  emitPlan: true
variants: 4
`;
    expect(parseYaml(yaml)).toEqual({
      templateId: 'versus-classic',
      subjects: [{ player: 'Peyz' }, { player: 'Viper' }],
      text: { headline: 'RIVALS' },
      output: { dir: './out', emitPlan: true },
      variants: 4,
    });
  });

  it('reads a sequence of multi-key maps', () => {
    const yaml = `
subjects:
  - player: Peyz
    side: left
    accent: "#E2012D"
  - player: Viper
    side: right
`;
    expect(parseYaml(yaml)).toEqual({
      subjects: [
        { player: 'Peyz', side: 'left', accent: '#E2012D' },
        { player: 'Viper', side: 'right' },
      ],
    });
  });

  it('reads a top-level array of documents', () => {
    expect(parseYaml('- templateId: a\n- templateId: b')).toEqual([{ templateId: 'a' }, { templateId: 'b' }]);
  });

  it('parses scalars by type', () => {
    const out = parseYaml('a: 1\nb: 1.5\nc: true\nd: false\ne: null\nf: ~\ng: text') as Record<string, unknown>;
    expect(out).toEqual({ a: 1, b: 1.5, c: true, d: false, e: null, f: null, g: 'text' });
  });

  it('keeps a hex colour as a string', () => {
    // `#E2012D` unquoted would otherwise be eaten as a comment, and a bare
    // `1v1` must not be coerced to 1.
    expect(parseYaml('accent: "#E2012D"\nmode: 1v1')).toEqual({ accent: '#E2012D', mode: '1v1' });
  });

  it('strips comments but not a # inside quotes', () => {
    expect(parseYaml('a: 1 # trailing\n# whole line\nb: "no # comment"')).toEqual({ a: 1, b: 'no # comment' });
  });

  it('reads inline flow collections', () => {
    expect(parseYaml('tags: [a, b, c]\nsize: {w: 2, h: 1}')).toEqual({ tags: ['a', 'b', 'c'], size: { w: 2, h: 1 } });
  });

  it('handles quoted keys and escapes', () => {
    expect(parseYaml('"left-name": "A\\nB"')).toEqual({ 'left-name': 'A\nB' });
  });

  it('treats an empty value as null', () => {
    expect(parseYaml('a:\nb: 1')).toEqual({ a: null, b: 1 });
  });

  it('ignores document markers and blank lines', () => {
    expect(parseYaml('---\n\na: 1\n\n...')).toEqual({ a: 1 });
  });

  it('returns an empty object for an empty document', () => {
    expect(parseYaml('')).toEqual({});
    expect(parseYaml('# only a comment')).toEqual({});
  });

  describe('refuses what it cannot do, rather than guessing', () => {
    // Silently mis-parsing a construct into a plausible-but-wrong request is
    // far worse than saying "not supported".
    it('anchors', () => {
      expect(() => parseYaml('base: &a\n  x: 1')).toThrow(YamlError);
    });

    it('block scalars', () => {
      expect(() => parseYaml('text: |\n  a long line')).toThrow(/Block scalars/);
    });

    it('tab indentation', () => {
      expect(() => parseYaml('a:\n\tb: 1')).toThrow(/Tab/);
    });

    it('an unterminated quote', () => {
      expect(() => parseYaml('a: "unclosed')).toThrow(YamlError);
    });

    it('a line that is not a pair', () => {
      expect(() => parseYaml('just some words')).toThrow(/key: value/);
    });
  });

  it('reports the line number of a problem', () => {
    try {
      parseYaml('a: 1\nb: 2\ntext: |\n  x');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(YamlError);
      expect((e as YamlError).line).toBe(3);
    }
  });
});

describe('formatOf', () => {
  it('recognises the supported extensions', () => {
    expect(formatOf('a.json')).toBe('json');
    expect(formatOf('a.yaml')).toBe('yaml');
    expect(formatOf('a.yml')).toBe('yaml');
    expect(formatOf('a.csv')).toBe('csv');
    expect(formatOf('a.tsv')).toBe('csv');
  });

  it('is case-insensitive', () => {
    expect(formatOf('/tmp/REQUEST.JSON')).toBe('json');
  });

  it('refuses anything else, and the hint says what is supported', () => {
    try {
      formatOf('a.txt');
      throw new Error('should have thrown');
    } catch (e) {
      expect(isHexaError(e)).toBe(true);
      expect((e as HexaError).code).toBe('INVALID_REQUEST');
      expect((e as HexaError).message).toContain('a.txt');
      expect((e as HexaError).hint).toMatch(/\.json/);
    }
  });
});
