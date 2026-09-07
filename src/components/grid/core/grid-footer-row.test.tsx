import { describe, it, expect, vi } from 'vitest'
vi.unmock('dayjs')

import { render, screen } from '../../../test/utils'
import { DataGrid } from '../index'

/**
 * The grid virtualizes its rows, and @tanstack/react-virtual sizes its window
 * from the scroll viewport's `offsetHeight` — which jsdom always reports as 0.
 * virtual-core's calculateRange returns an EMPTY range (not an overscan-sized
 * one) at zero height, so without this the grid renders a header and no body
 * rows at all. See DataGrid.test.tsx for the same stub.
 */
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return this.hasAttribute('data-grid-body-viewport') ? 600 : 0
  },
})

interface Row {
  id: string
  project: string
  hours: number
}

const data: Row[] = [
  { id: '1', project: 'Apollo', hours: 7.5 },
  { id: '2', project: 'Zephyr', hours: 2.5 },
]

const columns = [
  { accessorKey: 'project', header: 'Project', footer: 'Total' },
  {
    accessorKey: 'hours',
    header: 'Hours',
    meta: { filterType: 'number' as const },
    footer: () => '10.00',
  },
]

describe('footer row', () => {
  it('renders a footer cell per column that declares one', () => {
    render(<DataGrid<Row> data={data} columns={columns} variant="simple" />)

    const footer = screen.getByRole('row', { name: /total/i })
    expect(footer).toBeInTheDocument()
    expect(screen.getByText('10.00')).toBeInTheDocument()
  })

  it('renders no footer when no column declares one', () => {
    render(
      <DataGrid<Row>
        data={data}
        columns={[{ accessorKey: 'project', header: 'Project' }]}
        variant="simple"
      />,
    )

    expect(
      screen.queryByRole('row', { name: /total/i }),
    ).not.toBeInTheDocument()
  })

  it('keeps the total under its column after the column order changes', () => {
    // The footer reads the same ordered-visible-leaf-columns geometry as the
    // header, so a reorder must move the total with its column rather than
    // leaving it under the wrong one.
    const { container } = render(
      <DataGrid<Row> data={data} columns={columns} variant="simple" />,
    )

    const headerCells = container.querySelectorAll('thead th')
    const footerCells = container.querySelectorAll('tfoot td')
    expect(footerCells.length).toBe(headerCells.length)
  })

  // Step 1's test above only checks that the two cell COUNTS match — that
  // passes even if the footer read columns from the wrong place, as long as
  // the wrong place still yields the same number of visible columns. This is
  // the guarantee's real test: after a reorder AND a hide, each footer cell's
  // data-column-id must match the header cell at the same position, not just
  // be present somewhere.
  it('keeps each total under the SAME column id after a reorder and a hide', () => {
    // Arrange — mount with the original order (project, hours)
    const { container, rerender } = render(
      <DataGrid<Row> data={data} columns={columns} variant="simple" />,
    )

    // Act — re-render with hours first, project second, and a third column
    // (category) hidden via meta.unavailable (no accessor collision with the
    // footer columns, so this only exercises reorder + hide).
    const reordered = [
      {
        accessorKey: 'hours',
        header: 'Hours',
        meta: { filterType: 'number' as const },
        footer: () => '10.00',
      },
      {
        id: 'category',
        header: 'Category',
        meta: { unavailable: true },
      },
      { accessorKey: 'project', header: 'Project', footer: 'Total' },
    ]
    rerender(<DataGrid<Row> data={data} columns={reordered} variant="simple" />)

    // Assert — the header now renders hours then project (category stays
    // hidden), and the footer's cells follow the SAME sequence of column ids,
    // position for position.
    const headerIds = Array.from(
      container.querySelectorAll('thead th[data-column-id]'),
    ).map((th) => th.getAttribute('data-column-id'))
    const footerIds = Array.from(
      container.querySelectorAll('tfoot td[data-column-id]'),
    ).map((td) => td.getAttribute('data-column-id'))

    expect(headerIds).toEqual(['hours', 'project'])
    expect(footerIds).toEqual(headerIds)
  })
})
