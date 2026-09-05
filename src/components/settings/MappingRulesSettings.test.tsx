import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import MappingRulesSettings from './MappingRulesSettings'
import {
  getMappingRules,
  createMappingRule,
  updateMappingRule,
  deleteMappingRule,
  reorderMappingRules,
  applyMappingRules,
  InvalidMappingRuleError
} from '../../api/mapping'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'
import { getEventTypes } from '../../api/eventTypes'

// importActual keeps the real InvalidMappingRuleError: an automocked class
// never runs its constructor, so `message` would come back empty and the
// component's instanceof check would stop meaning what these tests expect.
vi.mock('../../api/mapping', async () => {
  const actual = await vi.importActual('../../api/mapping')
  return {
    ...actual,
    getMappingRules: vi.fn(),
    createMappingRule: vi.fn(),
    updateMappingRule: vi.fn(),
    deleteMappingRule: vi.fn(),
    reorderMappingRules: vi.fn(),
    applyMappingRules: vi.fn()
  }
})
vi.mock('../../api/projects', () => ({ getProjects: vi.fn() }))
vi.mock('../../api/activities', () => ({ getActivities: vi.fn() }))
vi.mock('../../api/eventTypes', () => ({ getEventTypes: vi.fn() }))

const mockRules = [
  {
    id: 1, priority: 1, name_operator: 'is' as const, name_value: 'Daily Standup',
    category_value: null, type_id: null, project_id: 1, activity_id: 5, is_active: true
  },
  {
    id: 2, priority: 2, name_operator: 'contains' as const, name_value: 'Escalation',
    category_value: 'Support', type_id: 10, project_id: 2, activity_id: null, is_active: true
  },
  {
    id: 3, priority: 3, name_operator: null, name_value: null,
    category_value: 'Recruiting', type_id: null, project_id: 1, activity_id: null, is_active: false
  }
]

const mockProjects = [
  { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true },
  { id: 2, name: 'Billing Migration', code: 'PRJ-002', program: null, is_active: true }
]
const mockActivities = [
  { id: 5, name: 'Software Development', color: '#1890ff', is_active: true }
]
const mockTypes = [
  { id: 10, name: 'Work', color: '#0a8bed', is_billable: true, all_day_hours: 8 },
  { id: 11, name: 'Info', color: '#0b8000', is_billable: false, all_day_hours: 8 }
]

describe('MappingRulesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMappingRules).mockResolvedValue(mockRules)
    vi.mocked(getProjects).mockResolvedValue(mockProjects)
    vi.mocked(getActivities).mockResolvedValue(mockActivities)
    vi.mocked(getEventTypes).mockResolvedValue(mockTypes)
  })

  it('lists the rules it loads', async () => {
    render(<MappingRulesSettings />)

    await waitFor(() => {
      expect(screen.getByText('Daily Standup')).toBeInTheDocument()
    })
    expect(screen.getByText('Escalation')).toBeInTheDocument()
  })

  /* Conditions read as prose so the list is scannable. A rule testing name
     AND category AND type has to say so. */
  it('reads a multi-condition rule as prose', async () => {
    render(<MappingRulesSettings />)

    await waitFor(() => expect(screen.getByText('Escalation')).toBeInTheDocument())

    expect(screen.getByText(/name contains/)).toBeInTheDocument()
    // Rules 2 and 3 both test a category, so this is deliberately getAllByText.
    expect(screen.getAllByText(/category is/).length).toBeGreaterThan(0)
    expect(screen.getByText(/type is/)).toBeInTheDocument()
    expect(screen.getByText('Work')).toBeInTheDocument()
  })

  it('resolves project codes and activity names rather than showing ids', async () => {
    render(<MappingRulesSettings />)

    // Rules 1 and 3 both target PRJ-001.
    await waitFor(() => expect(screen.getAllByText('PRJ-001').length).toBe(2))
    expect(screen.getByText('Software Development')).toBeInTheDocument()
  })

  /* "No activity" is a real answer, so it must read as one and not as a gap. */
  it('shows a rule with no activity as Project only', async () => {
    render(<MappingRulesSettings />)

    await waitFor(() => expect(screen.getByText('PRJ-002')).toBeInTheDocument())
    expect(screen.getAllByText('Project only').length).toBeGreaterThan(0)
  })

  it('creates a rule from the add modal', async () => {
    const user = userEvent.setup()
    vi.mocked(createMappingRule).mockResolvedValue(mockRules[0])
    render(<MappingRulesSettings />)
    await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /add rule/i }))
    await user.type(await screen.findByPlaceholderText('e.g. Daily Standup'), 'Retro')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(createMappingRule).toHaveBeenCalledWith(
        expect.objectContaining({ name_value: 'Retro', project_id: 1 })
      )
    })
  })

  /* The sentinel the Select uses for "no activity" must become null on the
     way out, not leak -1 into the database. */
  it('sends a null activity rather than the no-activity sentinel', async () => {
    const user = userEvent.setup()
    vi.mocked(createMappingRule).mockResolvedValue(mockRules[0])
    render(<MappingRulesSettings />)
    await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /add rule/i }))
    await user.type(await screen.findByPlaceholderText('e.g. Daily Standup'), 'Retro')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(createMappingRule).toHaveBeenCalledWith(
        expect.objectContaining({ activity_id: null })
      )
    })
  })

  /* An operator with no value would be meaningless, and would make the
     backend treat the rule as testing the name when it does not. */
  it('drops the name operator when no name was entered', async () => {
    const user = userEvent.setup()
    vi.mocked(createMappingRule).mockResolvedValue(mockRules[0])
    render(<MappingRulesSettings />)
    await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /add rule/i }))
    await user.type(await screen.findByPlaceholderText('e.g. Scrum'), 'Scrum')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(createMappingRule).toHaveBeenCalledWith(
        expect.objectContaining({ name_operator: null, category_value: 'Scrum' })
      )
    })
  })

  it('updates an existing rule through the edit modal', async () => {
    const user = userEvent.setup()
    vi.mocked(updateMappingRule).mockResolvedValue(mockRules[0])
    render(<MappingRulesSettings />)
    await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Edit Daily Standup' }))
    const nameField = await screen.findByPlaceholderText('e.g. Daily Standup')
    await user.clear(nameField)
    await user.type(nameField, 'Standup')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(updateMappingRule).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ name_value: 'Standup' })
      )
    })
  })

  it('deletes a rule after the confirmation is accepted', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteMappingRule).mockResolvedValue(true)
    render(<MappingRulesSettings />)
    await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Delete Daily Standup' }))
    await user.click(await screen.findByRole('button', { name: /^yes$/i }))

    await waitFor(() => expect(deleteMappingRule).toHaveBeenCalledWith(1))
  })

  /* Order is the entire semantics of this list. Moving a rule sends the whole
     new order, so no half-order with duplicate priorities can exist. */
  it('reorders by sending every id in the new order', async () => {
    const user = userEvent.setup()
    vi.mocked(reorderMappingRules).mockResolvedValue(undefined)
    render(<MappingRulesSettings />)
    await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Move Escalation up' }))

    await waitFor(() => expect(reorderMappingRules).toHaveBeenCalledWith([2, 1, 3]))
  })

  it('cannot move the first rule up or the last one down', async () => {
    render(<MappingRulesSettings />)
    await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'Move Daily Standup up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Recruiting down' })).toBeDisabled()
  })

  it('reports how many events a re-run mapped', async () => {
    const user = userEvent.setup()
    vi.mocked(applyMappingRules).mockResolvedValue({
      evaluated: 120, mapped: 96, skippedManual: 4
    })
    render(<MappingRulesSettings />)
    await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /re-run on all events/i }))

    await waitFor(() => {
      expect(screen.getByText(/Mapped 96 of 120 events/)).toBeInTheDocument()
    })
    expect(screen.getByText(/4 mapped by hand were left alone/)).toBeInTheDocument()
  })

  /* A rule that tests nothing would match every event, so the backend refuses
     it and the reason has to reach the user verbatim. */
  it('shows the backend reason when a rule tests nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(createMappingRule).mockRejectedValue(
      new InvalidMappingRuleError(
        'A rule needs at least one condition - a name, a category or an event type.'
      )
    )
    render(<MappingRulesSettings />)
    await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /add rule/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(screen.getByText(/needs at least one condition/)).toBeInTheDocument()
    })
  })

  /* A rule must map to a project, so with none there is nothing to add. */
  it('disables adding and explains why when there are no projects', async () => {
    vi.mocked(getProjects).mockResolvedValue([])
    render(<MappingRulesSettings />)

    await waitFor(() => {
      expect(screen.getByText('No projects yet')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /add rule/i })).toBeDisabled()
  })

  it('filters the list by the settings search term', async () => {
    render(<MappingRulesSettings searchTerm="escalation" />)

    await waitFor(() => expect(screen.getByText('Escalation')).toBeInTheDocument())
    expect(screen.queryByText('Daily Standup')).not.toBeInTheDocument()
  })

  it('reports a load failure instead of rendering an empty list silently', async () => {
    vi.mocked(getMappingRules).mockRejectedValue(new Error('boom'))
    render(<MappingRulesSettings />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load mapping rules')).toBeInTheDocument()
    })
  })
})
