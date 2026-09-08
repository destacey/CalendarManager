import React from 'react'
import { Tooltip } from 'antd'

interface GridTooltipProps {
  title?: React.ReactNode
  children: React.ReactNode
}

/**
 * The grid's tooltip. A thin wrapper so header labels and toolbar buttons can
 * pass a possibly-absent title without each call site guarding for it —
 * antd's Tooltip still renders a wrapper span for an empty title, which
 * disturbs header layout.
 */
const GridTooltip: React.FC<GridTooltipProps> = ({ title, children }) => {
  if (!title) return <>{children}</>
  return <Tooltip title={title}>{children}</Tooltip>
}

export default GridTooltip
