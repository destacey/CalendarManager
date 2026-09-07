import type { ReactNode } from 'react'
import { App } from 'antd'

/**
 * The `modal` returned by `App.useApp()`. A row action's dropdown-menu
 * `onClick` cannot host an anchored `Popconfirm` the way an inline button
 * could, so `App.useApp().modal.confirm({...})` is the replacement — this
 * type just names its shape so {@link confirmDelete} doesn't have to import
 * antd's internal modal-hook module path.
 */
export type ConfirmModal = ReturnType<typeof App.useApp>['modal']

export interface ConfirmDeleteOptions {
  /**
   * The modal body — describes what deleting does (what's removed, what it
   * affects). Required: this is "the thing being deleted", the reason a
   * confirmation exists at all.
   */
  content: ReactNode
  /** Runs when the user confirms. */
  onConfirm: () => void | Promise<void>
  /** Modal title. Defaults to `'Are you sure?'`. */
  title?: ReactNode
  /** OK button text. Defaults to `'Delete'`. */
  okText?: string
}

/**
 * Shows a danger-styled `modal.confirm` for a destructive row action.
 *
 * A plain function, not a hook: it takes the caller's own `modal` (from
 * their own `App.useApp()`) as a parameter rather than calling `App.useApp()`
 * itself, so it can be called from an event handler (a menu item's
 * `onClick`) rather than only from a component or hook body — which calling
 * `App.useApp()` internally would have required.
 *
 * Every migration with a destructive row action hits the same problem
 * `EventTypesSettings.tsx` did: `createActionsColumn`'s dropdown menu items
 * can't anchor a `Popconfirm`. This centralizes the `modal.confirm` shape so
 * it isn't reinvented per migration.
 */
export const confirmDelete = (
  modal: ConfirmModal,
  { content, onConfirm, title = 'Are you sure?', okText = 'Delete' }: ConfirmDeleteOptions,
): void => {
  modal.confirm({
    title,
    content,
    okText,
    okButtonProps: { danger: true },
    onOk: onConfirm,
  })
}
