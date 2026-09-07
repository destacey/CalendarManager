import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.unmock('dayjs')

vi.mock('../../../api/files', () => ({ saveFile: vi.fn() }))

import { saveFile } from '../../../api/files'
import { exportGridToCsv } from './grid-export'
import { buildHeadlessTable } from './test-table'

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('exportGridToCsv', () => {
  beforeEach(() => {
    vi.mocked(saveFile).mockReset()
    vi.mocked(saveFile).mockResolvedValue(true)
  })

  it('writes through the native save dialog, not a browser download', async () => {
    // WebView2 ignores a Blob <a download> entirely, so the only correct
    // path is the backend writing to a user-picked path.
    const table = buildHeadlessTable(
      [{ name: 'Ada', hours: 8 }],
      [
        { accessorKey: 'name', header: 'Name' },
        { accessorKey: 'hours', header: 'Hours' },
      ]
    )

    const written = await exportGridToCsv(table, 'timecards')

    expect(written).toBe(true)
    expect(saveFile).toHaveBeenCalledTimes(1)
    const [name, bytes, filterName, extensions] = vi.mocked(saveFile).mock.calls[0]
    expect(name).toMatch(/^timecards-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(filterName).toBe('CSV')
    expect(extensions).toEqual(['csv'])
    expect(decode(bytes)).toContain('Name,Hours')
    expect(decode(bytes)).toContain('Ada,8')
  })

  it('prefixes a UTF-8 BOM so Excel does not mojibake multibyte text', async () => {
    const table = buildHeadlessTable(
      [{ name: 'Café 🚀' }],
      [{ accessorKey: 'name', header: 'Name' }]
    )

    await exportGridToCsv(table, 'events')

    const bytes = vi.mocked(saveFile).mock.calls[0][1]
    // EF BB BF
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(decode(bytes)).toContain('Café 🚀')
  })

  it('reports a cancelled dialog without throwing', async () => {
    vi.mocked(saveFile).mockResolvedValue(false)
    const table = buildHeadlessTable(
      [{ name: 'Ada' }],
      [{ accessorKey: 'name', header: 'Name' }]
    )

    await expect(exportGridToCsv(table, 'events')).resolves.toBe(false)
  })

  it('honours meta.enableExport, exportHeader and exportFormatter', async () => {
    const table = buildHeadlessTable(
      [{ name: 'Ada', secret: 'x', hours: 8 }],
      [
        { accessorKey: 'name', header: 'Name', meta: { exportHeader: 'Person' } },
        { accessorKey: 'secret', header: 'Secret', meta: { enableExport: false } },
        {
          accessorKey: 'hours',
          header: 'Hours',
          meta: { exportFormatter: (v: unknown) => `${v}h` },
        },
      ]
    )

    await exportGridToCsv(table, 'events')

    const csv = decode(vi.mocked(saveFile).mock.calls[0][1])
    expect(csv).toContain('Person,Hours')
    expect(csv).not.toContain('Secret')
    expect(csv).toContain('Ada,8h')
  })
})
