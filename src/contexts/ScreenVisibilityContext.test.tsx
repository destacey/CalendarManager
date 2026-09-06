import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { ScreenVisibilityProvider, useReloadOnShow } from './ScreenVisibilityContext'

const Loader = ({ onReload }: { onReload: () => void }) => {
  useReloadOnShow(onReload)
  return <div>loader</div>
}

/** A screen that can be hidden and shown, the way App does it. */
const Screen = ({ onReload, startActive = true }: { onReload: () => void; startActive?: boolean }) => {
  const [active, setActive] = useState(startActive)
  return (
    <>
      <button onClick={() => setActive(a => !a)}>toggle</button>
      <ScreenVisibilityProvider active={active}>
        <Loader onReload={onReload} />
      </ScreenVisibilityProvider>
    </>
  )
}

describe('useReloadOnShow', () => {
  /* The component's own mount effect has just loaded; firing here as well
     would double every screen's first visit. */
  it('does not fire on mount', () => {
    const onReload = vi.fn()
    render(<Screen onReload={onReload} />)

    expect(onReload).not.toHaveBeenCalled()
  })

  it('fires when the screen becomes visible', () => {
    const onReload = vi.fn()
    const { getByText } = render(<Screen onReload={onReload} />)

    fireEvent.click(getByText('toggle')) // hidden
    fireEvent.click(getByText('toggle')) // shown again

    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('does not fire when the screen is hidden', () => {
    const onReload = vi.fn()
    const { getByText } = render(<Screen onReload={onReload} />)

    fireEvent.click(getByText('toggle'))

    expect(onReload).not.toHaveBeenCalled()
  })

  it('fires again on every later visit', () => {
    const onReload = vi.fn()
    const { getByText } = render(<Screen onReload={onReload} />)

    for (let i = 0; i < 3; i++) {
      fireEvent.click(getByText('toggle'))
      fireEvent.click(getByText('toggle'))
    }

    expect(onReload).toHaveBeenCalledTimes(3)
  })

  /* A component mounted while its screen is hidden — a settings tab opened
     later — still gets its reload when the screen appears. */
  it('fires for something mounted while hidden', () => {
    const onReload = vi.fn()
    const { getByText } = render(<Screen onReload={onReload} startActive={false} />)

    fireEvent.click(getByText('toggle'))

    expect(onReload).toHaveBeenCalledTimes(1)
  })

  /* Nothing outside a provider has a screen to be shown on, and must not be
     reloaded on every render. */
  it('never fires with no provider above it', () => {
    const onReload = vi.fn()
    render(<Loader onReload={onReload} />)

    expect(onReload).not.toHaveBeenCalled()
  })
})
