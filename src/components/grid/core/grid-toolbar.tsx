'use client'

import styles from './grid-toolbar.module.css'
import { Button, Input, Popover, Typography } from 'antd'
import GridTooltip from '../GridTooltip'
import {
  ClearOutlined,
  DownloadOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'

const { Text } = Typography

export interface GridToolbarProps {
  displayedRowCount: number
  totalRowCount: number
  searchValue: string
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRefresh?: () => Promise<any> | void
  onClearFilters: () => void
  hasActiveFilters: boolean
  /**
   * Export-to-CSV handler. Deliberately just a callback: CSV export in this
   * app goes through a native save dialog (WebView2 silently ignores a Blob
   * `<a download>`), which makes the real implementation async — the toolbar
   * never calls the export module directly, so it doesn't care whether the
   * caller's handler is sync or async.
   */
  onExportCsv?: () => void
  isLoading: boolean
  /** Whether to show the global search input. Default: true. */
  includeGlobalSearch?: boolean
  /** Slot for domain-specific actions rendered on the left. */
  leftSlot?: React.ReactNode
  /** Content rendered inside the help popover. */
  helpContent?: React.ReactNode
  /** Slot for actions rendered just BEFORE the export/help group, set apart by
   *  a divider on each side. For a grid-specific toggle. No consumer yet. */
  actionsSlot?: React.ReactNode
  /** Slot for actions rendered on the far right of the toolbar. */
  rightSlot?: React.ReactNode
}

/**
 * The one grid toolbar: search, row count, refresh, clear filters, export CSV,
 * and help popover. Domain-specific actions go in `leftSlot` / `rightSlot`;
 * `rightSlot` renders at the far right, after export/help — view selectors
 * and control menus belong there.
 */
const GridToolbar = ({
  displayedRowCount,
  totalRowCount,
  searchValue,
  onSearchChange,
  onRefresh,
  onClearFilters,
  hasActiveFilters,
  onExportCsv,
  actionsSlot,
  isLoading,
  includeGlobalSearch = true,
  leftSlot,
  helpContent,
  rightSlot,
}: GridToolbarProps) => {
  return (
    <div className={styles.toolbar}>
      <div>{leftSlot}</div>

      <div className={styles.toolbarRight}>
        <Text>
          {displayedRowCount} of {totalRowCount}
        </Text>
        {includeGlobalSearch && (
          <Input
            placeholder="Search"
            allowClear={true}
            value={searchValue}
            onChange={onSearchChange}
            suffix={<SearchOutlined />}
            className={styles.toolbarSearch}
          />
        )}
        {onRefresh && (
          <GridTooltip title="Refresh">
            <Button
              type="text"
              shape="circle"
              icon={<ReloadOutlined />}
              onClick={onRefresh}
            />
          </GridTooltip>
        )}
        <GridTooltip title="Clear Filters and Sorting">
          <Button
            type="text"
            shape="circle"
            icon={<ClearOutlined />}
            onClick={onClearFilters}
            disabled={!hasActiveFilters}
          />
        </GridTooltip>
        {actionsSlot && (
          <>
            <span className={styles.toolbarDivider} />
            {actionsSlot}
          </>
        )}
        {onExportCsv && (
          <>
            <span className={styles.toolbarDivider} />
            <GridTooltip title="Export to CSV">
              <Button
                type="text"
                shape="circle"
                icon={<DownloadOutlined />}
                onClick={onExportCsv}
                disabled={isLoading || displayedRowCount === 0}
              />
            </GridTooltip>
          </>
        )}
        {helpContent && (
          <Popover
            content={helpContent}
            trigger="click"
            placement="bottomRight"
            getPopupContainer={() => document.body}
            overlayStyle={{ maxWidth: 'calc(100vw - 24px)' }}
          >
            <GridTooltip title="Grid Actions Help">
              <Button
                type="text"
                shape="circle"
                icon={<QuestionCircleOutlined />}
              />
            </GridTooltip>
          </Popover>
        )}
        {rightSlot}
      </div>
    </div>
  )
}

export default GridToolbar
