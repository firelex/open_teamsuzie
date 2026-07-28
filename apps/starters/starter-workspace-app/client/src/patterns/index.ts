/**
 * The canonical screen-pattern library. Every screen in a generated app renders
 * one of these archetypes (mapped from a layout.json pattern's `kind`). The
 * build agent authors a new pattern here ONLY when a layout pattern genuinely
 * has no canonical fit.
 */
export { CollectionWorkspace, type CollectionWorkspaceProps } from './CollectionWorkspace';
export { RecordWorkspace, type RecordWorkspaceProps } from './RecordWorkspace';
export { GuidedWorkflowRun, type GuidedWorkflowRunProps, type GuidedStep } from './GuidedWorkflowRun';
export { DeliverableReview, type DeliverableReviewProps } from './DeliverableReview';
export { ConfigEditor, type ConfigEditorProps } from './ConfigEditor';
