/**
 * @hexa/cli — the `hexa` command line.
 *
 * The binary is `bin.ts`; this entry exists so the program can be embedded,
 * tested, or wrapped by another tool without shelling out.
 */

export { buildProgram, commandNames, parseSeed, VERSION } from './program.js';
export { createContext, globalsFrom } from './context.js';
export type { CliContext, GlobalOptions } from './context.js';

export { EXIT_CODES, EXIT_OK, EXIT_UNKNOWN, EXIT_INTERRUPTED, exitCodeFor, describeError } from './exit.js';
export type { RenderedError } from './exit.js';

export { createUi, glyphs } from './ui/style.js';
export type { Ui } from './ui/style.js';
export { createSpinner, createProgressBar } from './ui/progress.js';
export { renderTable, formatBytes, formatDuration, formatScore, visibleLength, truncateVisible } from './ui/table.js';
export type { Column } from './ui/table.js';

export { parseYaml, YamlError } from './io/yaml.js';
export { parseCsv, parseCsvRows } from './io/csv.js';
export { loadRequests, readStructured, formatOf } from './io/request-file.js';

export { buildRequest, parseGrade, parseKeyValues, runGeneration, DEFAULT_TEMPLATE } from './commands/gen.js';
export { reportJob, topFindings, formatFinding } from './commands/report.js';
export type { Check, CheckStatus } from './commands/doctor.js';
