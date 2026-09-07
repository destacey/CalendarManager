import { describe, it, expect, vi } from 'vitest'
import { confirmDelete } from './confirm-delete'
import type { ConfirmModal } from './confirm-delete'

/** A minimal stand-in for `App.useApp().modal` — only `confirm` is used. */
const makeModal = () => ({ confirm: vi.fn() }) as unknown as ConfirmModal

describe('confirmDelete', () => {
  it('shows a danger-styled confirm with the default title and OK text', () => {
    // Arrange
    const modal = makeModal()
    const onConfirm = vi.fn()

    // Act
    confirmDelete(modal, { content: 'This will remove it.', onConfirm })

    // Assert
    expect(modal.confirm).toHaveBeenCalledWith({
      title: 'Are you sure?',
      content: 'This will remove it.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: onConfirm,
    })
  })

  it('lets the caller override the title and OK text', () => {
    // Arrange
    const modal = makeModal()
    const onConfirm = vi.fn()

    // Act
    confirmDelete(modal, {
      content: 'Rule will be removed.',
      onConfirm,
      title: 'Delete this rule?',
      okText: 'Remove',
    })

    // Assert
    expect(modal.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Delete this rule?', okText: 'Remove' }),
    )
  })

  it('runs onConfirm when the modal invokes onOk', () => {
    // Arrange
    const modal = makeModal()
    const onConfirm = vi.fn()

    // Act
    confirmDelete(modal, { content: 'x', onConfirm })
    const call = vi.mocked(modal.confirm).mock.calls[0][0]
    call.onOk?.()

    // Assert
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
