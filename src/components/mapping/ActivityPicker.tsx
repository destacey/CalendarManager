import React, { useState } from 'react'
import { Typography, theme } from 'antd'
import { Project, Activity } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import { mapEvents, UnmappedGroup } from '../../api/mapping'

const { Text } = Typography

interface ActivityPickerProps {
  project: Project
  /** Every group being mapped — one, or a whole ctrl-click selection. */
  groups: UnmappedGroup[]
  activities: Activity[]
  /** Viewport coordinates of the drop, so this opens where the user let go. */
  x: number
  y: number
  onDone: () => void
  onCancel: () => void
}

/**
 * The decision at the end of a drop: which activity, if any.
 *
 * It owns the commit rather than reporting a choice upwards, because "pick an
 * activity and map these events" is one action — splitting it would leave the
 * write with no natural home and nothing testable without a real drag.
 *
 * One click finishes it. There is deliberately no search box and no confirm
 * step; the list is short and the whole point is speed.
 */
const ActivityPicker: React.FC<ActivityPickerProps> = ({
  project,
  groups,
  activities,
  x,
  y,
  onDone,
  onCancel
}) => {
  const { token } = theme.useToken()
  const messageApi = useMessage()
  const [busy, setBusy] = useState(false)

  const commit = async (activityId: number | null) => {
    if (busy) return
    setBusy(true)

    const eventIds = groups.flatMap(g => g.eventIds)
    const activityName = activityId != null ? activities.find(a => a.id === activityId)?.name : null

    try {
      const n = await mapEvents(eventIds, project.id!, activityId)
      messageApi.success(
        `${n} event${n === 1 ? '' : 's'} mapped to ${project.name}` +
          (activityName ? ` · ${activityName}` : '')
      )
      onDone()
    } catch (error) {
      console.error('Error mapping events:', error)
      messageApi.error('Failed to map events')
      setBusy(false)
    }
  }

  return (
    <>
      {/* Clicking away cancels without mapping anything. */}
      <div onClick={onCancel} data-testid="picker-scrim" style={{ position: 'fixed', inset: 0, zIndex: 1000 }} />
      <div
        role="menu"
        aria-label="Choose an activity"
        style={{
          position: 'fixed',
          left: x,
          top: y,
          zIndex: 1001,
          width: 268,
          maxHeight: 360,
          overflowY: 'auto',
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorder}`,
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowSecondary,
          padding: 6
        }}
      >
        <div style={{ padding: '6px 10px 8px' }}>
          <Text strong style={{ fontSize: 12 }}>
            Activity
          </Text>
          <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
            — one click to finish
          </Text>
        </div>

        {/* First, not buried: mapping to a project with no activity is a real
            answer and often the right one. */}
        <Option label="Project only, no activity" onPick={() => commit(null)} />

        <div style={{ height: 1, background: token.colorSplit, margin: '4px 8px' }} />

        {activities.map(activity => (
          <Option
            key={activity.id}
            label={activity.name}
            color={activity.color}
            onPick={() => commit(activity.id!)}
          />
        ))}
      </div>
    </>
  )
}

const Option: React.FC<{ label: string; color?: string; onPick: () => void }> = ({
  label,
  color,
  onPick
}) => {
  const { token } = theme.useToken()
  const [hover, setHover] = useState(false)

  return (
    <div
      role="menuitem"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPick()
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '9px 11px',
        borderRadius: token.borderRadius,
        cursor: 'pointer',
        background: hover ? token.colorFillTertiary : undefined,
        fontSize: 13
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: 2,
          background: color ?? token.colorTextQuaternary,
          flexShrink: 0
        }}
      />
      <span style={{ color: color ? undefined : token.colorTextSecondary }}>{label}</span>
    </div>
  )
}

export default ActivityPicker
