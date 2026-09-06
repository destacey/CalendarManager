import React, { useMemo, useState } from 'react'
import { Modal, Typography, Flex, Button, Select, InputNumber, Empty, Alert } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { Project, Activity } from '../../types'
import { TimecardEntry, EntryInput } from '../../api/timecards'
import TimecardEntryTable, { projectLabel, NONE } from './TimecardEntryTable'

const { Text } = Typography

interface TimecardDayModalProps {
  date: string | null
  entries: TimecardEntry[]
  projects: Project[]
  activities: Activity[]
  disabled: boolean
  onClose: () => void
  onPatch: (entry: TimecardEntry, changes: Partial<TimecardEntry>) => void
  onDelete: (entry: TimecardEntry) => void
  onAdd: (entry: EntryInput) => void
}

/**
 * Everything behind one day of the grid.
 *
 * The grid shows a cell's total; this is where the items that make it up
 * live — their notes, and which event produced each one. Adding here is an
 * addition, not an override: a refresh still fills the day's cells from
 * events around it, which is what separates this from typing in a cell.
 */
const TimecardDayModal: React.FC<TimecardDayModalProps> = ({
  date,
  entries,
  projects,
  activities,
  disabled,
  onClose,
  onPatch,
  onDelete,
  onAdd
}) => {
  const [adding, setAdding] = useState(false)
  const [project, setProject] = useState<number>(NONE)
  const [activity, setActivity] = useState<number>(NONE)
  const [hours, setHours] = useState<number>(1)

  const total = useMemo(() => entries.reduce((sum, e) => sum + e.hours, 0), [entries])

  const close = () => {
    setAdding(false)
    onClose()
  }

  const add = () => {
    onAdd({
      date: date!,
      hours,
      project_id: project === NONE ? null : project,
      activity_id: activity === NONE ? null : activity,
      note: null
    })
    setAdding(false)
    setProject(NONE)
    setActivity(NONE)
    setHours(1)
  }

  return (
    <Modal
      title={date ? `Items on ${date}` : ''}
      open={date !== null}
      onCancel={close}
      footer={<Button onClick={close}>Close</Button>}
      width={900}
    >
      <Flex vertical gap={12}>
        <Flex justify="space-between" align="center">
          <Text strong>{total.toFixed(2)} hours</Text>
          <Button
            icon={<PlusOutlined />}
            size="small"
            disabled={disabled || adding}
            onClick={() => setAdding(true)}
          >
            Add item
          </Button>
        </Flex>

        {entries.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Nothing on this day"
          />
        ) : (
          <TimecardEntryTable
            entries={entries}
            projects={projects}
            activities={activities}
            disabled={disabled}
            onPatch={onPatch}
            onDelete={onDelete}
            showDate={false}
            showNote
          />
        )}

        {adding && (
          <Flex gap={8} wrap align="center">
            <InputNumber
              min={0}
              max={24}
              step={0.25}
              value={hours}
              onChange={value => setHours(value ?? 0)}
              aria-label="Hours for the new item"
              style={{ width: 90 }}
            />
            <Select
              value={project}
              style={{ minWidth: 220 }}
              onChange={setProject}
              aria-label="Project for the new item"
              options={[
                { value: NONE, label: 'Unassigned' },
                ...projects
                  .filter(p => p.is_active)
                  .map(p => ({ value: p.id!, label: projectLabel(p) }))
              ]}
            />
            <Select
              value={activity}
              style={{ minWidth: 180 }}
              onChange={setActivity}
              aria-label="Activity for the new item"
              options={[
                { value: NONE, label: 'No activity' },
                ...activities.filter(a => a.is_active).map(a => ({ value: a.id!, label: a.name }))
              ]}
            />
            <Button type="primary" onClick={add}>
              Add
            </Button>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
          </Flex>
        )}

        {entries.some(e => e.source === 'cell') && (
          <Alert
            type="info"
            showIcon
            message="A cell on this day was typed in, so a refresh will not add event time to it."
          />
        )}
      </Flex>
    </Modal>
  )
}

export default TimecardDayModal
