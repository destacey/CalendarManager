import React, { useState, useEffect } from 'react'
import { Typography, Checkbox, theme } from 'antd'
import { Project, Activity, MappingRule } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import {
  mapEvents, createMappingRule, updateMappingRule, getMappingRules, UnmappedGroup
} from '../../api/mapping'

const { Text } = Typography

interface ActivityPickerProps {
  project: Project
  /** Every group being mapped — one, or a whole ctrl-click selection. */
  groups: UnmappedGroup[]
  activities: Activity[]
  /** Only to name where an existing rule points, if there is one. */
  projects: Project[]
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
  projects,
  onDone,
  onCancel
}) => {
  const { token } = theme.useToken()
  const messageApi = useMessage()
  const [busy, setBusy] = useState(false)
  const [alsoRule, setAlsoRule] = useState(false)
  const [rules, setRules] = useState<MappingRule[]>([])

  /* Loaded so the checkbox can say whether a rule for this name already
     exists. Best-effort for the label only — the commit re-reads, so a slow
     or failed load here can never produce a duplicate. */
  useEffect(() => {
    getMappingRules()
      .then(setRules)
      .catch(error => console.error('Error reading mapping rules:', error))
  }, [])

  // Escape cancels, as it would for any modal surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const eventCount = groups.reduce((n, g) => n + g.eventCount, 0)

  /**
   * The rule this group's quick rule owns: same name, matched the same way,
   * with no other condition narrowing it. A rule that also matches on a
   * category or an event type is a different, more specific rule and is left
   * alone.
   */
  const ruleFor = (title: string, all: MappingRule[]): MappingRule | undefined =>
    all.find(
      r =>
        r.name_operator === 'is' &&
        (r.name_value ?? '').toLowerCase() === title.toLowerCase() &&
        !r.category_value &&
        r.type_id == null
    )

  const existing = groups.length === 1 ? ruleFor(groups[0].title, rules) : undefined
  const existingProject = existing ? projects.find(p => p.id === existing.project_id) : undefined
  const existingActivity =
    existing?.activity_id != null ? activities.find(a => a.id === existing.activity_id) : undefined

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
          // Re-read rather than trust what was loaded when this opened: it is
          // the only thing standing between a second tick and a duplicate.
          const current = await getMappingRules()
          let made = 0
          let updated = 0
          let unchanged = 0

          for (const group of groups) {
            const input = {
              name_operator: 'is' as const,
              name_value: group.title,
              category_value: null,
              type_id: null,
              project_id: project.id!,
              activity_id: activityId,
              is_active: true
            }
            const owned = ruleFor(group.title, current)

            if (!owned) {
              await createMappingRule(input)
              made += 1
            } else if (owned.project_id === project.id && (owned.activity_id ?? null) === activityId) {
              // Already says exactly this. A second copy would only ever be
              // dead weight: the first match wins.
              unchanged += 1
            } else {
              // Pointing somewhere else. Leaving it would quietly contradict
              // the mapping just made, so it is moved rather than duplicated.
              await updateMappingRule(owned.id!, input)
              updated += 1
            }
          }

          const said = [
            made > 0 && `${made} rule${made === 1 ? '' : 's'} made`,
            updated > 0 && `${updated} rule${updated === 1 ? '' : 's'} pointed here instead`,
            unchanged > 0 && `${unchanged} already said so`
          ].filter(Boolean)
          messageApi.success(said.join(', '))
        } catch (error) {
          console.error('Error saving a mapping rule:', error)
          messageApi.warning('Events mapped, but the rule could not be saved')
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
            {groups.length > 1 ? (
              <>Also map future events with these {groups.length} names here</>
            ) : existing ? (
              // Naming where it points now is the whole value of saying
              // anything: an existing rule aimed elsewhere is exactly how
              // future events end up somewhere other than this drop.
              <>
                Point the rule for &ldquo;{groups[0].title}&rdquo; here
                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                  now {existingProject?.code ?? `#${existing.project_id}`}
                  {existingActivity ? ` · ${existingActivity.name}` : ' · no activity'}
                </Text>
              </>
            ) : (
              <>Also map future events named &ldquo;{groups[0].title}&rdquo; here</>
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
