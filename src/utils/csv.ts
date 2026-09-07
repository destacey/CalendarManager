/**
 * Leading characters that make a spreadsheet parse a cell as a formula.
 * `=HYPERLINK("http://evil")` executes on open, and quoting does not defuse
 * it — the cell has to stop looking like a formula.
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r']

/** Strings only: a numeric `-5` is data the spreadsheet should still read as
 *  a number. */
const isFormula = (value: unknown, str: string): boolean =>
  typeof value === 'string' && FORMULA_TRIGGERS.includes(str[0])

/** Escapes a single value for CSV. */
export const escapeCsv = (value: unknown): string => {
  const str = value == null ? '' : String(value)
  // A leading apostrophe means "literal text" and is consumed on import.
  const defused = isFormula(value, str) ? `'${str}` : str
  const escaped = defused.replace(/"/g, '""')
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped
}

/** Builds CSV content from a header row and body rows. */
export const generateCsv = (headers: string[], rows: unknown[][]): string =>
  [
    headers.map(escapeCsv).join(','),
    ...rows.map(row => row.map(escapeCsv).join(',')),
  ].join('\n')
