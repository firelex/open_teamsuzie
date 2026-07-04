/**
 * The data-testid contract.
 *
 * These ids are FIXED by the template and baked into the shell, top bar,
 * approval flow, and every canonical screen pattern — so the journey-driven
 * acceptance tests have deterministic targets regardless of an app's domain
 * content. The build agent should NOT rename these; it reuses them by rendering
 * the canonical patterns. Per-instance ids (a specific nav item, a specific row)
 * are derived via the helper functions so they stay collision-free but stable.
 */
export const testid = {
  // Auth gate (the whole app sits behind this — anon users see the login page,
  // never the shell).
  authLoading: 'auth-loading',
  loginScreen: 'login-screen',
  loginButton: 'login-button',

  // Shell
  appShell: 'app-shell',
  sidebar: 'app-sidebar',
  navItem: (id: string) => `nav-${id}`,

  // Top bar (governance spine)
  topBar: 'top-bar',
  creditBalance: 'credit-balance',
  approvalsIndicator: 'approvals-indicator',
  auditLink: 'audit-link',

  // Global approval flow
  confirmDialog: 'confirm-dialog',
  confirmAccept: 'confirm-accept',
  confirmCancel: 'confirm-cancel',

  // Canonical pattern roots
  collectionWorkspace: 'collection-workspace',
  recordWorkspace: 'record-workspace',
  guidedWorkflowRun: 'guided-workflow-run',
  deliverableReview: 'deliverable-review',
  configEditor: 'config-editor',

  // Common pattern controls
  primaryAction: 'primary-action',
  dataTable: 'data-table',
  rowAction: (rowId: string) => `row-action-${rowId}`,
  bulkActionBar: 'bulk-action-bar',
  emptyState: 'empty-state',
  generatingPanel: 'generating-panel',
} as const;
