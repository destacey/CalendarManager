import React, { useState, useEffect } from 'react'
import { Typography, Checkbox, theme } from 'antd'
import { Project, Activity } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import { mapEvents, createMappingRule, UnmappedGroup } from '../../api/mapping'

const { Text } = Typography

interface ActivityPickerProps {
  project: Project
  /** Every group being mapped — one, or a whole ctrl-click selection. */
  groups: UnmappedGroup[]
  activities: Activity[]
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
 *
 * It is CENTRED rather than anchored to the drop point. Anchoring put it
 * partly off-screen when the project dropped on was low in the viewport, with
 * no way to scroll to the rest — and it bought nothing, because the activity
 * list is identical whichever project you drop on. Centring costs the spatial
 * cue of which project that was, so the header names it instead.
 */
const ActivityPicker: React.FC<ActivityPickerProps> = ({
  project,
  groups,
  activities,
  onDone,
  onCancel
}) => {
  const { token } = theme.useToken()
  const messageApi = useMessage()
  const [busy, setBusy] = useState(false)
  const [alsoRule, setAlsoRule] = useState(false)

  // Escape cancels, as it would for any modal surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const eventCount = groups.reduce((n, g) => n + g.eventCount, 0)

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

      if (alsoRule) {
        // One rule per group, matched on the event name. A rule failing must
        // not undo or obscure the mapping that already succeeded, so it is
        // reported on its own and the drop still counts as done.
        try {
          for (const group of groups) {
            await createMappingRule({
              name_operator: 'is',
              name_value: group.title,
              category_value: null,
              type_id: null,
              project_id: project.id!,
              activity_id: activityId,
              is_active: true
            })
          }
          messageApi.success(
            groups.length === 1
              ? `Future events named "${groups[0].title}" will map here too`
              : `${groups.length} rules made for future events`
          )
        } catch (error) {
          console.error('Error creating a mapping rule:', error)
          messageApi.warning('Events mapped, but the rule could not be made')
        }
      }

      onDone()
    } catch (error) {
      console.error('Error mapping events:', error)
      messageApi.error('Failed to map events')
      setBusy(false)
    }
  }

  return (
    <div
      onClick={onCancel}
      data-testid="picker-scrim"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.35)'
      }}
    >
      <div
        role="menu"
        aria-label="Choose an activity"
        // Stops a click on the menu itself reaching the scrim behind it.
        onClick={e => e.stopPropagation()}
        style={{
          width: 300,
          // Never taller than the viewport, and scrolls inside itself when the
          // activity list outgrows it — the failure the anchored version had.
          maxHeight: 'min(70vh, 520px)',
          display: 'flex',
          flexDirection: 'column',
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorder}`,
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowSecondary,
          padding: 6
        }}
      >
        <div style={{ padding: '8px 10px 10px', flexShrink: 0 }}>
          <div>
            <Text strong style={{ fontSize: 13 }}>
              Activity
            </Text>
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
              — one click to finish
            </Text>
          </div>
          {/* Centring loses the spatial cue of which project was dropped on,
              so it is stated. */}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {eventCount} event{eventCount === 1 ? '' : 's'} &rarr; {project.name}
          </Text>

          {/* Ticked before the activity is chosen, so one click still
              finishes: the rule is made with whatever that click picks. */}
          <Checkbox
            checked={alsoRule}
            onChange={e => setAlsoRule(e.target.checked)}
            style={{ marginTop: 8, fontSize: 12 }}
          >
            {groups.length === 1 ? (
              <>Also map future events named &ldquo;{groups[0].title}&rdquo; here</>
            ) : (
              <>Also map future events with these {groups.length} names here</>
            )}
          </Checkbox>
        </div>

        {/* First, not buried: mapping to a project with no activity is a real
            answer and often the right one. */}
        <div style={{ overflowY: 'auto', flexGrow: 1 }}>
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
      </div>
    </div>
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
