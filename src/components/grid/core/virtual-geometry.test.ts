import { virtualSpacers } from './virtual-geometry'

describe('virtualSpacers', () => {
  test('are zero when nothing is rendered', () => {
    // Arrange / Act
    const spacers = virtualSpacers({
      firstRowStart: 0,
      lastRowEnd: 0,
      totalSize: 0,
      hasRows: false,
    })

    // Assert
    expect(spacers).toEqual({ top: 0, bottom: 0 })
  })

  test('cover the offset above and below the rendered window', () => {
    // Arrange / Act
    const spacers = virtualSpacers({
      firstRowStart: 280,
      lastRowEnd: 840,
      totalSize: 1260,
      hasRows: true,
    })

    // Assert
    expect(spacers).toEqual({ top: 280, bottom: 420 })
  })

  test('keep total content height equal to the virtualizer-reported extent', () => {
    // Arrange — spacers plus rendered rows must add up to totalSize.
    const ESTIMATE = 28
    const totalRows = 45
    const renderedRows = 28
    const firstRowStart = 10 * ESTIMATE

    // Act
    const spacers = virtualSpacers({
      firstRowStart,
      lastRowEnd: firstRowStart + renderedRows * ESTIMATE,
      totalSize: totalRows * ESTIMATE,
      hasRows: true,
    })
    const gridHeight = spacers.top + renderedRows * ESTIMATE + spacers.bottom

    // Assert
    expect(gridHeight).toBe(totalRows * ESTIMATE)
  })
})
