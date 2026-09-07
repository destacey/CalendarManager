import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
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

/**
 * The grid virtualizes its rows, and @tanstack/react-virtual sizes its window
 * from the scroll viewport's `offsetHeight` — which jsdom always reports as 0.
 * Without this stub the grid renders a header and no body rows at all, so
 * every row-content assertion below would fail. See DataGrid.test.tsx.
 */
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return this.hasAttribute('data-grid-body-viewport') ? 600 : 0
  },
})

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

    // Individual per-action buttons were replaced by the grid's single "..."
    // row-actions dropdown; open the Daily Standup row's (index 0) and click
    // Edit. antd 6 renders a menu item's icon label inline with its text, so
    // an anchored /^edit$/i regex matches nothing — match a substring.
    await user.click(screen.getAllByLabelText('Row actions')[0])
    await user.click(await screen.findByText(/edit/i))
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

    // A menu item's onClick can't host an anchored Popconfirm, so delete now
    // confirms through a modal (confirmDelete), whose OK button reads
    // "Delete" rather than the old Popconfirm's "Yes".
    await user.click(screen.getAllByLabelText('Row actions')[0])
    await user.click(await screen.findByText(/delete/i))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

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

  /* The Order column's "#" and its arrows read `rule.priority`, never the
     grid's row-render position (see the comment above the `columns` array in
     MappingRulesSettings.tsx). The test above can't prove that: its fixture's
     priorities (1, 2, 3) match array position exactly, so it passes
     identically whether the code reads `priority` or a row's display index.
     This one sorts the grid by a column OTHER than priority first, so the
     two diverge, then proves the correct record moves — not whichever record
     happened to render in that screen position. */
  it('moves the record whose priority matches, not whichever row renders in that position after a sort', async () => {
    const user = userEvent.setup()
    const rules = [
      { id: 10, priority: 1, name_operator: 'is' as const, name_value: 'Alpha', category_value: null, type_id: null, project_id: 1, activity_id: null, is_active: false },
      { id: 20, priority: 2, name_operator: 'is' as const, name_value: 'Bravo', category_value: null, type_id: null, project_id: 1, activity_id: null, is_active: true },
      { id: 30, priority: 3, name_operator: 'is' as const, name_value: 'Charlie', category_value: null, type_id: null, project_id: 1, activity_id: null, is_active: false }
    ]
    vi.mocked(getMappingRules).mockResolvedValue(rules)
    vi.mocked(reorderMappingRules).mockResolvedValue(undefined)
    render(<MappingRulesSettings />)
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

    // Sort by Active (ascending: "No" before "Yes"). The DISPLAYED order
    // becomes Alpha, Charlie, Bravo — Bravo (real priority 2, index 1) now
    // renders third (index 2).
    await user.click(screen.getByText('Active'))
    await waitFor(() => {
      const rows = screen.getAllByText(/^(Alpha|Bravo|Charlie)$/)
      expect(rows.map(r => r.textContent)).toEqual(['Alpha', 'Charlie', 'Bravo'])
    })

    await user.click(screen.getByRole('button', { name: 'Move Bravo up' }))

    // Correct: swap priority-index 1 (Bravo) with priority-index 0 (Alpha) —
    // id 20 and id 10 trade places, id 30 (Charlie) is untouched.
    // A row-index-based bug would instead swap displayed index 2 with 1
    // (Bravo and Charlie: ids 20 and 30), leaving Alpha's id (10) untouched.
    await waitFor(() => expect(reorderMappingRules).toHaveBeenCalledWith([20, 10, 30]))
  })

  describe('re-running the rules', () => {
    const run = { evaluated: 120, mapped: 96, overwritten: 0, cleared: 0, skippedManual: 4 }

    const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
      render(<MappingRulesSettings />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: /re-run on all events/i }))
      return screen.getByRole('dialog')
    }

    /* A run that can rewrite existing work is not something to trigger with
       one click, so the button asks first. */
    it('asks before running anything', async () => {
      const user = userEvent.setup()
      vi.mocked(applyMappingRules).mockResolvedValue(run)

      await openDialog(user)

      expect(applyMappingRules).not.toHaveBeenCalled()
      expect(screen.getByText(/only events with no mapping will be touched/i)).toBeInTheDocument()
    })

    it('fills blanks only unless told otherwise', async () => {
      const user = userEvent.setup()
      vi.mocked(applyMappingRules).mockResolvedValue(run)
      const dialog = await openDialog(user)

      await user.click(within(dialog).getByRole('button', { name: /^run$/i }))

      await waitFor(() => expect(applyMappingRules).toHaveBeenCalledWith(false))
    })

    it('overwrites when the box is ticked, and says what that means first', async () => {
      const user = userEvent.setup()
      vi.mocked(applyMappingRules).mockResolvedValue({ ...run, overwritten: 7, cleared: 2 })
      const dialog = await openDialog(user)

      await user.click(within(dialog).getByRole('checkbox'))
      expect(
        screen.getByText(/mappings you made by hand can be moved/i)
      ).toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: /^run$/i }))

      await waitFor(() => expect(applyMappingRules).toHaveBeenCalledWith(true))
    })

    it('reports what the run did', async () => {
      const user = userEvent.setup()
      vi.mocked(applyMappingRules).mockResolvedValue({ ...run, overwritten: 7, cleared: 2 })
      const dialog = await openDialog(user)

      await user.click(within(dialog).getByRole('button', { name: /^run$/i }))

      await waitFor(() =>
        expect(screen.getByText(/Mapped 96 of 120 events/)).toBeInTheDocument()
      )
      expect(screen.getByText(/7 replaced/)).toBeInTheDocument()
      expect(screen.getByText(/2 cleared/)).toBeInTheDocument()
      expect(screen.getByText(/4 mapped by hand were left alone/)).toBeInTheDocument()
    })

    /* Ticking it once must not make every later run destructive. */
    it('forgets the tick once the run is done', async () => {
      const user = userEvent.setup()
      vi.mocked(applyMappingRules).mockResolvedValue(run)
      const dialog = await openDialog(user)

      await user.click(within(dialog).getByRole('checkbox'))
      await user.click(within(dialog).getByRole('button', { name: /^run$/i }))
      await waitFor(() => expect(applyMappingRules).toHaveBeenCalledWith(true))

      await user.click(screen.getByRole('button', { name: /re-run on all events/i }))

      expect(screen.getByRole('checkbox', { checked: false })).toBeInTheDocument()
    })
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

  it('shows the section when the search term matches a rule by name, without filtering its rows', async () => {
    // Row-level filtering now belongs to the grid's own toolbar search, not
    // this page-level searchTerm prop — it only gates whether the whole
    // section renders. A matching term still shows every row.
    render(<MappingRulesSettings searchTerm="escalation" />)

    await waitFor(() => expect(screen.getByText('Escalation')).toBeInTheDocument())
    expect(screen.getByText('Daily Standup')).toBeInTheDocument()
  })

  it('reports a load failure instead of rendering an empty list silently', async () => {
    vi.mocked(getMappingRules).mockRejectedValue(new Error('boom'))
    render(<MappingRulesSettings />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load mapping rules')).toBeInTheDocument()
    })
  })
})
