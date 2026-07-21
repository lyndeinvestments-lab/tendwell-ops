/**
 * English strings for the Tasks surface (the internal task manager at
 * /tasks — lists, board/calendar views, assignees, watchers, comments,
 * subtasks/reparenting, and list management). Source of truth for keys;
 * `tasks.es.ts` is typed as `typeof tasksEn` so TypeScript enforces key
 * parity between the two.
 *
 * DB enum values (`tasks.status`, `tasks.priority`, `tasks.category`,
 * `task_assignees.role`) stay canonical English in the database; the
 * `status.*` / `priority.*` / `category.*` / `assigneeRole.*` namespaces
 * below are display-only lookups keyed by slug, falling back to the raw
 * value itself if a key is ever missing.
 */
// Deliberately NOT `as const`: TS widens these string literals to `string`,
// so `tasksEs: typeof tasksEn` enforces key-shape parity (every key present
// with a string value) without also locking Spanish values to the literal
// English strings — which `as const` would do and defeat the point.
export const tasksEn = {
  // `tasks.status` — canonical English in the DB.
  status: {
    to_do: 'To Do',
    in_progress: 'In Progress',
    done: 'Done',
    blocked: 'Blocked',
  },
  // `tasks.priority` — canonical English in the DB.
  priority: {
    urgent: 'Urgent',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  },
  // `tasks.category` — canonical English in the DB.
  category: {
    general: 'General',
    cleaning: 'Cleaning',
    maintenance: 'Maintenance',
    onboarding: 'Onboarding',
    client: 'Client',
    finance: 'Finance',
    admin: 'Admin',
  },
  // `task_assignees.role` — canonical English ('primary'/'secondary') in the DB.
  assigneeRole: {
    primary: 'primary',
    secondary: 'secondary',
  },
  // `task_list_members.role` — canonical English ('owner'/'member') in the DB.
  listMemberRole: {
    owner: 'owner',
    member: 'member',
  },
  // Small, widely reused field labels/words shared across the table, the
  // detail sheet, and the new-task form.
  common: {
    unassigned: 'Unassigned',
    noProperty: 'No Property',
    noStatus: 'No Status',
    noPriority: 'No Priority',
    optional: 'Optional',
    noDate: 'No date',
    dueToday: 'Today',
    overdueDays: '{{count}}d overdue',
    dueInDays: '{{count}}d',
    privateSuffix: ' (private)',
    publicSuffix: ' (public)',
    priorityLabel: 'Priority',
    assigneeLabel: 'Assignee',
    categoryLabel: 'Category',
    dueDateLabel: 'Due Date',
    createdLabel: 'Created',
    createdByLabel: 'Created By',
  },
  // Page shell: list selector bar, header actions, summary tiles, filters.
  page: {
    allMyTasks: 'All My Tasks',
    tasksFallback: 'Tasks',
    newList: 'New List',
    viewList: 'List',
    viewBoard: 'Board',
    viewCalendar: 'Calendar',
    exportButton: 'Export',
    newTask: 'New Task',
    subtitleOverdue: '{{count}} overdue',
    subtitleSummary: '{{inProgress}} in progress · {{todo}} to do · {{done}} done',
    tileOverdue: 'Overdue',
    filterOpen: 'Open ({{count}})',
    filterAll: 'All ({{count}})',
    priorityFilterAll: 'Priority: All',
    assigneeFilterAll: 'Assignee: All',
    groupNone: 'Group: None',
    reset: 'Reset',
    searchPlaceholder: 'Search…',
    ariaFilterPriority: 'Filter by priority',
    ariaFilterAssignee: 'Filter by assignee',
    ariaGroupBy: 'Group by',
  },
  // Task-list create/manage dialogs + the list selector's own actions.
  lists: {
    createListTitle: 'Create Task List',
    listNamePlaceholder: 'List name…',
    create: 'Create',
    manageTitle: 'Manage: {{name}}',
    colorLabel: 'Your color for this list',
    membersLabel: 'Members ({{count}})',
    noMembersYet: 'No members yet',
    addMember: 'Add member',
    allUsersAdded: 'All users added',
    deleteListButton: 'Delete List',
    confirmDeleteList: 'Delete this list? Tasks in it will become unassigned.',
  },
  // List-view table: headers, tooltips, empty states, bulk-select bar. Also
  // covers the Kanban board's empty-column text (shares `emptyTitle`).
  table: {
    colTask: 'Task',
    colDue: 'Due',
    colAction: 'Action',
    selectAllAria: 'Select all eligible tasks',
    selectRowAria: 'Select {{title}}',
    hasSubtasksTitle: 'Has subtasks - cannot become a subtask',
    alreadySubtaskTitle: 'Already a subtask',
    emptyTitle: 'No tasks',
    emptyFiltered: 'No tasks match your filters.',
    emptyDefault: 'Create your first task to get started.',
    selectedCount: '{{count}} selected',
    clear: 'Clear',
  },
  // CalendarView month grid.
  calendar: {
    weekdaySun: 'Sun',
    weekdayMon: 'Mon',
    weekdayTue: 'Tue',
    weekdayWed: 'Wed',
    weekdayThu: 'Thu',
    weekdayFri: 'Fri',
    weekdaySat: 'Sat',
    more: '+{{count}} more',
  },
  // ReparentPopover ("Make subtasks of…" bulk bar action + detail sheet's
  // "Move under…" single-task action).
  reparent: {
    tabExisting: 'Existing task',
    tabNew: 'New parent',
    searchPlaceholder: 'Search tasks…',
    noMatchesSearch: 'No matching top-level tasks',
    noEligibleParents: 'No eligible parents available',
    parentTitleLabel: 'Parent task title',
    parentTitlePlaceholder: 'e.g. Onboarding - 123 Main St',
    createAndMove: 'Create & move {{count}} task(s)',
    hint: 'List, priority, and category inherit from the first selected task. You can edit details after creation.',
    makeSubtasksOf: 'Make subtasks of…',
    moveUnder: 'Move under…',
  },
  // Task detail sheet (excluding comments — see `comments` below).
  detail: {
    descriptionLabel: 'Description',
    subtasksLabel: 'Subtasks',
    addSubtask: 'Add subtask',
    subtaskTitlePrompt: 'Subtask title:',
    parentPrefix: 'Parent: ',
    parentFallback: 'Parent task',
    assigneesHeader: 'Assignees',
    noAssignees: 'No assignees',
    addAssignee: 'Add assignee',
    addAsPrimary: 'Primary',
    addAsSecondary: 'Secondary',
    watchersHeader: 'Watchers',
    noWatchers: 'No watchers',
    addWatcher: 'Add watcher',
    listHeader: 'List',
    deleteTask: 'Delete Task',
    confirmDeleteTask: 'Delete this task?',
  },
  // Comments section within the detail sheet.
  comments: {
    header: 'Comments',
    empty: 'No comments yet.',
    placeholder: 'Add a comment… use @ to mention',
  },
  // New Task sheet.
  form: {
    titleLabel: 'Title *',
    titlePlaceholder: 'What needs to be done?',
    listLabel: 'List *',
    noListsAvailable: 'No lists available',
    descriptionPlaceholder: 'Details…',
    creating: 'Creating…',
    createTask: 'Create Task',
  },
  toasts: {
    taskCreated: 'Task created',
    createFailed: 'Failed to create task',
    taskUpdated: 'Task updated',
    updateFailed: 'Update failed',
    commentFailed: 'Failed to add comment',
    taskDeleted: 'Task deleted',
    deleteFailed: 'Delete failed',
    movedSingle: 'Moved task under parent',
    movedMultiple: 'Moved {{count}} tasks under parent',
    reparentFailed: 'Reparent failed',
    parentCreated: 'Created parent with {{count}} subtask(s)',
    createParentFailed: 'Failed to create parent',
    taskMoved: 'Task moved',
    listCreated: 'List "{{name}}" created',
    addMemberFailed: 'Failed to add member',
    memberAdded: 'Member added',
    memberRemoved: 'Member removed',
    listDeleted: 'List deleted',
    errorParentNotFound: 'Parent task not found',
    errorTasksNotLoaded: 'Tasks not loaded',
    errorNoTaskSelected: 'No selected task found',
    errorParentCreationFailed: 'Parent creation failed',
  },
}
