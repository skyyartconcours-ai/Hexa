/**
 * RFC 4180 CSV reader.
 *
 * Small, but the quoting rules are the whole point: a batch file of thumbnail
 * titles is exactly the kind of data that contains commas ("Peyz, again"),
 * embedded quotes and the occasional newline. A naive `split(',')` gets those
 * wrong silently, which is worse than getting them wrong loudly.
 */

export interface CsvOptions {
  delimiter?: string;
  /** Treat the first row as column names. Default true. */
  header?: boolean;
}

/** Parse into row objects keyed by the header. */
export function parseCsv(text: string, opts: CsvOptions = {}): Record<string, string>[] {
  const rows = parseCsvRows(text, opts);
  if (rows.length === 0) return [];
  if (opts.header === false) {
    return rows.map((cells) => Object.fromEntries(cells.map((c, i) => [String(i), c])));
  }

  const header = rows[0]!.map((h, i) => (h.trim() === '' ? `column${i + 1}` : h.trim()));
  return rows.slice(1)
    // A trailing newline yields one empty cell; that is not a row.
    .filter((cells) => cells.some((c) => c.trim() !== ''))
    .map((cells) => {
      const row: Record<string, string> = {};
      header.forEach((name, i) => {
        row[name] = cells[i] ?? '';
      });
      return row;
    });
}

/** Parse into raw cell arrays, honouring quotes and embedded newlines. */
export function parseCsvRows(text: string, opts: CsvOptions = {}): string[][] {
  const delimiter = opts.delimiter ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;

  // Strip a UTF-8 BOM: Excel writes one, and it would otherwise become part of
  // the first column's name and break every lookup against it.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endCell = (): void => {
    row.push(cell);
    cell = '';
  };
  const endRow = (): void => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (i < source.length) {
    const ch = source[i]!;

    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    if (ch === '"' && cell === '') {
      quoted = true;
      i++;
      continue;
    }
    if (source.startsWith(delimiter, i)) {
      endCell();
      i += delimiter.length;
      continue;
    }
    if (ch === '\r') {
      // CRLF or a lone CR both end the row.
      endRow();
      i += source[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i++;
      continue;
    }
    cell += ch;
    i++;
  }

  if (cell !== '' || row.length > 0) endRow();
  return rows;
}
