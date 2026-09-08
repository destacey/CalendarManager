import { describe, it, expect } from 'vitest'
import { escapeCsv, generateCsv } from './csv'

describe('escapeCsv', () => {
  it('passes plain values through', () => {
    expect(escapeCsv('Design review')).toBe('Design review')
  })

  it('renders null and undefined as empty', () => {
    expect(escapeCsv(null)).toBe('')
    expect(escapeCsv(undefined)).toBe('')
  })

  it('quotes values containing a comma, quote or newline', () => {
    expect(escapeCsv('Smith, John')).toBe('"Smith, John"')
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"')
  })

  it('defuses strings a spreadsheet would run as a formula', () => {
    // =HYPERLINK("http://evil") executes on open, and quoting does not stop
    // it - the cell has to stop looking like a formula. A leading apostrophe
    // means "literal text" and is consumed on import.
    expect(escapeCsv('=HYPERLINK("http://evil")')).toBe(
      '"\'=HYPERLINK(""http://evil"")"'
    )
    expect(escapeCsv('+1')).toBe("'+1")
    expect(escapeCsv('-cmd')).toBe("'-cmd")
    expect(escapeCsv('@handle')).toBe("'@handle")
  })

  it('leaves a negative number alone', () => {
    // Data the spreadsheet should still read as a number, not text.
    expect(escapeCsv(-5)).toBe('-5')
  })
})

describe('generateCsv', () => {
  it('joins headers and rows with escaping applied', () => {
    const csv = generateCsv(
      ['Name', 'Hours'],
      [
        ['Smith, John', 7.5],
        ['Ada', 8],
      ]
    )
    expect(csv).toBe('Name,Hours\n"Smith, John",7.5\nAda,8')
  })

  it('handles no rows', () => {
    expect(generateCsv(['Name'], [])).toBe('Name')
  })
})
