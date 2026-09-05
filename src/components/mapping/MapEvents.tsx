import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Typography, Space, Button, Empty, Spin, Switch, Flex, Tag, theme, Splitter, Input } from 'antd'
import { HolderOutlined, LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import dayjs, { Dayjs } from 'dayjs'
import { Project, Activity } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import { getUnmappedGroups, UnmappedGroup } from '../../api/mapping'
import ActivityPicker from './ActivityPicker'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'

const { Text, Title } = Typography

interface MapEventsProps {
  /* Tells the app events changed so the calendar reloads when next shown.
     Deliberately NOT a remount: `<CalendarView key={...} />` destroyed and
     rebuilt the whole subtree, which docs/backlog.md records as the wrong
     mechanism and which was half the flash after every drop. */
  onEventsChanged?: () => void
}

/** What a drop is about to map, once the user picks an activity. */
interface PickerState {
  project: Project
  groups: UnmappedGroup[]
}

/* Exported for its own tests: the dimming below depends on a drag being in
   progress, and dnd-kit cannot be driven in jsdom, so the only way to cover it
   is to render the card directly with `dragActive` set. */
export const GroupCard: React.FC<{
  group: UnmappedGroup
  selected: boolean
  /** True while ANY card of the current selection is being dragged. */
  dragActive: boolean
  onSelect: (group: UnmappedGroup, additive: boolean) => void
}> = ({ group, selected, dragActive, onSelect }) => {
  const { token } = theme.useToken()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: group.key,
    data: { group }
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${group.title}, ${group.eventCount} events`}
      onClick={e => onSelect(group, e.ctrlKey || e.metaKey || e.shiftKey)}
      style={{
        border: `1px solid ${selected ? token.colorPrimary : token.colorBorder}`,
        background: selected ? token.colorPrimaryBg : token.colorBgContainer,
        boxShadow: selected ? `inset 3px 0 0 ${token.colorPrimary}` : undefined,
        borderRadius: token.borderRadius,
        padding: '9px 12px',
        cursor: 'grab',
        /* Every selected card dims, not just the one under the cursor.
           `isDragging` is true only for the card holding the handle, so a
           three-group drag used to leave two of them looking untouched -
           which read as if only one was coming along. */
        opacity: isDragging || (dragActive && selected) ? 0.4 : 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 5
      }}
    >
      <Flex align="center" gap={8}>
        <HolderOutlined style={{ color: token.colorTextQuaternary }} />
        <Text strong={selected}>{group.title}</Text>
        <Tag color={selected ? 'blue' : 'default'} style={{ marginInlineEnd: 0 }}>
          {group.eventCount}
        </Tag>
        <div style={{ flexGrow: 1 }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {formatEffort(group)}
        </Text>
      </Flex>
      <Flex align="center" gap={6} style={{ paddingLeft: 22 }}>
        {group.categories ? (
          group.categories.split(',').map(c => (
            <Tag key={c} style={{ marginInlineEnd: 0, fontSize: 11 }}>
              {c.trim()}
            </Tag>
          ))
        ) : (
          <Text type="secondary" italic style={{ fontSize: 11 }}>
            no categories
          </Text>
        )}
        {group.typeName && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {group.typeName}
          </Text>
        )}
      </Flex>
    </div>
  )
}

const ProjectRow: React.FC<{ project: Project; children?: React.ReactNode }> = ({
  project,
  children
}) => {
  const { token } = theme.useToken()
  const { setNodeRef, isOver } = useDroppable({ id: `project-${project.id}`, data: { project } })

  return (
    <div
      ref={setNodeRef}
      data-testid={`project-drop-${project.id}`}
      style={{
        border: `1px ${isOver ? 'dashed' : 'solid'} ${isOver ? token.colorPrimary : token.colorBorder}`,
        background: isOver ? token.colorPrimaryBg : token.colorBgContainer,
        borderRadius: token.borderRadius,
        padding: '11px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}
    >
      <Text code>{project.code}</Text>
      <Text strong type={project.is_active ? undefined : 'secondary'}>
        {project.name}
      </Text>
      {project.program && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {project.program}
        </Text>
      )}
      {/* Shown rather than merely dimmed: dropping onto a retired project is
          a real choice, and it should be an obvious one. */}
      {!project.is_active && (
        <Tag style={{ marginInlineEnd: 0, fontSize: 11 }}>Inactive</Tag>
      )}
      <div style={{ flexGrow: 1 }} />
      {children}
    </div>
  )
}

/**
 * All-day events are shown as a count rather than folded into hours: how many
 * hours an all-day event is worth is still an open, configurable question, and
 * inventing a number here would be the same bug the billable footer already
 * has.
 */
function formatEffort(group: UnmappedGroup): string {
  const parts: string[] = []
  if (group.timedMinutes > 0) {
    const h = Math.floor(group.timedMinutes / 60)
    const m = group.timedMinutes % 60
    parts.push(h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`)
  }
  if (group.allDayCount > 0) {
    parts.push(`${group.allDayCount} all-day`)
  }
  return parts.join(' · ') || '—'
}

const MapEvents: React.FC<MapEventsProps> = ({ onEventsChanged }) => {
  const { token } = theme.useToken()
  const messageApi = useMessage()
  const [groups, setGroups] = useState<UnmappedGroup[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  /* Only the FIRST load blanks the board. Every later one — a month change, a
     filter toggle, the reload after mapping — keeps everything mounted and
     shows a small spinner instead. Swapping the whole splitter for a centred
     spinner and back is what made the page flash on every drop. */
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const hasLoaded = useRef(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [billableOnly, setBillableOnly] = useState(true)
  const [search, setSearch] = useState('')
  const [includeInactiveProjects, setIncludeInactiveProjects] = useState(false)
  const [month, setMonth] = useState<Dayjs>(dayjs())
  const [dragging, setDragging] = useState<UnmappedGroup | null>(null)
  const [picker, setPicker] = useState<PickerState | null>(null)

  // The distance constraint keeps a plain click a selection rather than a
  // drag the user did not mean. The keyboard sensor is not decoration: space
  // picks a group up, arrows move between projects, space drops - which makes
  // the whole board usable without a mouse, and testable without simulating
  // pointer physics.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const range = useMemo(
    () => ({
      start: month.startOf('month').format('YYYY-MM-DDTHH:mm:ss'),
      end: month.endOf('month').format('YYYY-MM-DDTHH:mm:ss')
    }),
    [month]
  )

  const load = useCallback(async () => {
    try {
      if (hasLoaded.current) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      const [g, p, a] = await Promise.all([
        getUnmappedGroups(range.start, range.end, billableOnly),
        getProjects(),
        getActivities()
      ])
      setGroups(g)
      setProjects(p)
      setActivities(a.filter(x => x.is_active))
      setSelectedKeys([])
    } catch (error) {
      console.error('Error loading unmapped events:', error)
      messageApi.error('Failed to load unmapped events')
    } finally {
      hasLoaded.current = true
      setLoading(false)
      setRefreshing(false)
    }
  }, [range.start, range.end, billableOnly, messageApi])

  useEffect(() => {
    load()
  }, [load])

  /* Matches the title and the categories, because a group is identified by
     both — "Scrum" should find the standups even though no title contains it. */
  const visibleGroups = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return groups
    return groups.filter(
      g =>
        g.title.toLowerCase().includes(term) || g.categories.toLowerCase().includes(term)
    )
  }, [groups, search])

  /* Deliberately over ALL groups, not the visible ones: a selection made
     before a search is still a selection, and dropping maps it in full. The
     header count keeps that honest by never hiding what is selected. */
  const selectedGroups = useMemo(
    () => groups.filter(g => selectedKeys.includes(g.key)),
    [groups, selectedKeys]
  )

  const hiddenSelectedCount = selectedGroups.filter(
    g => !visibleGroups.some(v => v.key === g.key)
  ).length

  /* Filtered here rather than at load, so toggling costs no round trip.
     Retired projects are hidden by default because mapping new work to one is
     almost always a mistake - but "almost" is why the toggle exists, for
     backfilling a month that predates the project being retired. */
  const visibleProjects = useMemo(
    () => (includeInactiveProjects ? projects : projects.filter(p => p.is_active)),
    [projects, includeInactiveProjects]
  )

  const inactiveProjectCount = projects.filter(p => !p.is_active).length

  const totalSelectedEvents = selectedGroups.reduce((n, g) => n + g.eventCount, 0)

  const handleSelect = (group: UnmappedGroup, additive: boolean) => {
    setSelectedKeys(keys => {
      if (additive) {
        return keys.includes(group.key) ? keys.filter(k => k !== group.key) : [...keys, group.key]
      }
      // A plain click replaces the selection; ctrl/cmd/shift extends it.
      return keys.length === 1 && keys[0] === group.key ? [] : [group.key]
    })
  }

  const handleDragStart = (event: DragStartEvent) => {
    const group = event.active.data.current?.group as UnmappedGroup | undefined
    if (!group) return
    setDragging(group)
    // Dragging an unselected card acts on that card alone, which is what a
    // user who never selected anything expects.
    if (!selectedKeys.includes(group.key)) {
      setSelectedKeys([group.key])
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const group = dragging
    setDragging(null)
    const project = event.over?.data.current?.project as Project | undefined
    if (!project || !group) return

    const dropped = selectedKeys.includes(group.key)
      ? groups.filter(g => selectedKeys.includes(g.key))
      : [group]

    setPicker({ project, groups: dropped })
  }

  const remaining = groups.reduce((n, g) => n + g.eventCount, 0)

  return (
    <div
      style={{
        padding: 24,
        height: '100%',
        // The page itself must not scroll: each splitter panel owns its own
        // scrollbar, so the header and the drag handle stay put while a long
        // list moves underneath them.
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}
    >
      <Flex align="baseline" gap={12} wrap style={{ flexShrink: 0 }}>
        <Title level={2} style={{ marginBottom: 0 }}>
          Map events
        </Title>
        <Text type="secondary">
          {remaining} unmapped event{remaining === 1 ? '' : 's'} in {groups.length} group
          {groups.length === 1 ? '' : 's'}
        </Text>
        <div style={{ flexGrow: 1 }} />
        {/* Prev/next rather than a DatePicker: stepping months is the only
            thing needed here, and it is one click instead of three. */}
        <Space size={4}>
          <Button
            icon={<LeftOutlined />}
            size="small"
            aria-label="Previous month"
            onClick={() => setMonth(m => m.subtract(1, 'month'))}
          />
          <Text style={{ minWidth: 110, textAlign: 'center' }}>{month.format('MMMM YYYY')}</Text>
          <Button
            icon={<RightOutlined />}
            size="small"
            aria-label="Next month"
            onClick={() => setMonth(m => m.add(1, 'month'))}
          />
        </Space>
        <Space size={6}>
          <Switch
            size="small"
            checked={billableOnly}
            onChange={setBillableOnly}
            aria-label="Billable types only"
          />
          <Text type="secondary" style={{ fontSize: 13 }}>
            Billable types only
          </Text>
        </Space>
      </Flex>

      {loading ? (
        <Flex justify="center" style={{ padding: 48 }}>
          <Spin />
        </Flex>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <Splitter style={{ flexGrow: 1, minHeight: 0 }}>
            {/* Bounded so neither side can be dragged away entirely — the
                board only works when both halves are visible. */}
            <Splitter.Panel defaultSize="38%" min="25%" max="65%">
              <div
                style={{
                  height: '100%',
                  overflowY: 'auto',
                  paddingRight: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}
              >
                <Flex align="center" gap={8} style={{ flexShrink: 0 }}>
                  <Text strong style={{ fontSize: 13 }}>
                    Unmapped
                  </Text>
                  {selectedKeys.length > 0 && (
                    <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                      {selectedKeys.length} selected · {totalSelectedEvents} events
                    </Tag>
                  )}
                  {refreshing && <Spin size="small" />}
                  <div style={{ flexGrow: 1 }} />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    ctrl-click to add
                  </Text>
                </Flex>

                <Input
                  allowClear
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search events and categories"
                  prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
                  style={{ flexShrink: 0 }}
                />

                {/* Says which selected groups the search is hiding, so the
                    count above can never look like it came from nowhere. */}
                {hiddenSelectedCount > 0 && (
                  <Text type="warning" style={{ fontSize: 11, flexShrink: 0 }}>
                    {hiddenSelectedCount} selected group
                    {hiddenSelectedCount === 1 ? ' is' : 's are'} hidden by this search, and will
                    still be mapped
                  </Text>
                )}

                {groups.length === 0 ? (
                  <Empty description="Nothing left to map for this month" />
                ) : visibleGroups.length === 0 ? (
                  <Empty description={`No events match "${search.trim()}"`} />
                ) : (
                  <Space orientation="vertical" size={7} style={{ width: '100%' }}>
                    {visibleGroups.map(group => (
                      <GroupCard
                        key={group.key}
                        group={group}
                        selected={selectedKeys.includes(group.key)}
                        dragActive={dragging !== null}
                        onSelect={handleSelect}
                      />
                    ))}
                  </Space>
                )}
              </div>
            </Splitter.Panel>

            <Splitter.Panel>
              <div
                style={{
                  height: '100%',
                  overflowY: 'auto',
                  paddingLeft: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}
              >
                <Flex align="center" gap={8} style={{ flexShrink: 0 }} wrap>
                  <Text strong style={{ fontSize: 13 }}>
                    Projects
                  </Text>
                  <div style={{ flexGrow: 1 }} />
                  {inactiveProjectCount > 0 && (
                    <Space size={6}>
                      <Switch
                        size="small"
                        checked={includeInactiveProjects}
                        onChange={setIncludeInactiveProjects}
                        aria-label="Include inactive projects"
                      />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Include inactive ({inactiveProjectCount})
                      </Text>
                    </Space>
                  )}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Drop the selection on a project
                  </Text>
                </Flex>

                {visibleProjects.length === 0 ? (
                  <Empty
                    description={
                      projects.length === 0
                        ? 'No projects — add one in Settings'
                        : 'No active projects — switch on "Include inactive" or add one in Settings'
                    }
                  />
                ) : (
                  <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    {visibleProjects.map(project => (
                      <ProjectRow key={project.id} project={project} />
                    ))}
                  </Space>
                )}
              </div>
            </Splitter.Panel>
          </Splitter>

          <DragOverlay>
            {dragging && (
              <div style={{ position: 'relative', width: 216 }}>
                {/* Ghost layers behind the card, one per extra group, so a
                    multi-group drag looks like a stack rather than a single
                    card that merely claims to be three. */}
                {selectedGroups.length > 1 &&
                  [...Array(Math.min(selectedGroups.length - 1, 2))].map((_, i) => (
                    <div
                      key={i}
                      style={{
                        position: 'absolute',
                        top: (i + 1) * 4,
                        left: (i + 1) * 4,
                        right: -(i + 1) * 4,
                        height: '100%',
                        border: `1px solid ${token.colorPrimaryBorder}`,
                        borderRadius: token.borderRadius,
                        background: token.colorBgElevated,
                        opacity: 0.75 - i * 0.25
                      }}
                    />
                  ))}
              <div
                style={{
                  position: 'relative',
                  border: `1px solid ${token.colorPrimary}`,
                  borderRadius: token.borderRadius,
                  background: token.colorBgElevated,
                  padding: '9px 11px',
                  boxShadow: token.boxShadowSecondary,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: 216,
                  boxSizing: 'border-box'
                }}
              >
                <HolderOutlined style={{ color: token.colorPrimary }} />
                <Text strong style={{ fontSize: 13 }}>
                  {selectedGroups.length > 1 ? `${selectedGroups.length} groups` : dragging.title}
                </Text>
                <div style={{ flexGrow: 1 }} />
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                  {selectedGroups.length > 1 ? totalSelectedEvents : dragging.eventCount}
                </Tag>
              </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}


      {picker && (
        <ActivityPicker
          project={picker.project}
          groups={picker.groups}
          activities={activities}
          onDone={() => {
            setPicker(null)
            onEventsChanged?.()
            load()
          }}
          onCancel={() => setPicker(null)}
        />
      )}
    </div>
  )
}

export default MapEvents
