// Utility
export { cn } from './lib/utils.js';
export { humanSize, safeFilename } from './lib/format.js';
export { WHIMSICAL_VERBS, prettyToolName, summarizeArgs } from './lib/tool-display.js';

// Icons — re-exported so consumer apps don't need to declare a separate
// lucide-react dependency. Curated set; if you need an icon that isn't
// here, add it explicitly (don't `export *` — lucide has names like
// `Badge`, `Sheet`, `Table` that collide with our component exports).
export {
  Activity,
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Briefcase,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  FolderPlus,
  GitCompareArrows,
  HelpCircle,
  History,
  Home,
  Inbox,
  Info,
  LayoutGrid,
  Link as LinkIcon,
  Loader2,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Minus,
  MoreHorizontal,
  MoreVertical,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings as SettingsIcon,
  Sparkles,
  Square,
  Star,
  Tag,
  Target,
  Trash2,
  Undo2,
  Upload,
  User,
  Users,
  X,
  XCircle,
} from 'lucide-react';
export type { LucideIcon } from 'lucide-react';

// Hooks
export { useSelectedModel } from './hooks/use-selected-model.js';
export { useAutoResizeTextarea } from './hooks/use-auto-resize-textarea.js';
export type { UseAutoResizeTextareaOptions } from './hooks/use-auto-resize-textarea.js';
export { useEscapeKey } from './hooks/use-escape-key.js';
export type { UseEscapeKeyOptions } from './hooks/use-escape-key.js';
export { useChatComposer } from './hooks/use-chat-composer.js';
export type {
  UseChatComposerOptions,
  UseChatComposerResult,
} from './hooks/use-chat-composer.js';
export { usePersonas, useSelectedPersona } from './hooks/use-personas.js';
export type {
  Persona,
  PersonaSource,
  PersonaCreateInput,
  PersonaUpdateInput,
  UsePersonasOptions,
  UsePersonasResult,
} from './hooks/use-personas.js';
export { useWorkflows } from './hooks/use-workflows.js';
export type {
  Workflow,
  WorkflowSource,
  WorkflowOutputMode,
  WorkflowColumnConfig,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  UseWorkflowsOptions,
  UseWorkflowsResult,
} from './hooks/use-workflows.js';
export { usePagination } from './lib/use-pagination.js';
export type {
  UsePaginationOptions,
  UsePaginationResult,
} from './lib/use-pagination.js';
export { progressiveArtifactStream } from './lib/progressive-artifact.js';
export type { ProgressiveArtifactStreamOptions } from './lib/progressive-artifact.js';

// Components
export * from './components/actions-menu.js';
export { AiFillButton, type AiFillButtonProps, type AiFillKind } from './components/ai-fill-button.js';
export * from './components/alert.js';
export * from './components/app-shell.js';
export * from './components/artifact-panel.js';
export * from './components/badge.js';
export * from './components/bulk-action-bar.js';
export * from './components/button.js';
export * from './components/card.js';
export * from './components/checkbox.js';
export * from './components/confirm-dialog.js';
export * from './components/toast.js';
export * from './components/data-table.js';
export * from './components/dialog.js';
export * from './components/dropdown-menu.js';
export * from './components/empty-state.js';
export * from './components/input.js';
export * from './components/label.js';
export * from './components/loading-state.js';
export * from './components/login-form.js';
export * from './components/markdown-message.js';
export * from './components/markdown-components.js';
export * from './components/markdown-view.js';
export * from './components/mermaid-block.js';
export * from './components/model-picker.js';
export * from './components/page-header.js';
export * from './components/page-hero-band.js';
export * from './components/page-shell.js';
export * from './components/page-body.js';
export * from './components/record-detail-layout.js';
export * from './components/property-panel.js';
export type {
  EditablePropertyDescriptor,
  EditablePropertyListProps,
  PropertyPanelProps,
  PropertyRowProps,
} from './components/property-panel.js';
export * from './components/activity-timeline.js';
export type {
  ActivityTimelineProps,
  TimelineEntry,
} from './components/activity-timeline.js';
export * from './components/pipeline-board.js';
export type {
  PipelineBoardProps,
  PipelineBoardStage,
} from './components/pipeline-board.js';
export * from './components/activity-pill.js';
export * from './components/generating-panel.js';
export * from './components/collapsible-side-panel.js';
export * from './components/pagination.js';
export * from './components/pending-button.js';
export * from './components/row-actions.js';
export * from './components/local-model-config-dialog.js';
export * from './components/persona-editor.js';
export * from './components/persona-picker.js';
export * from './components/workflow-picker-dialog.js';
export * from './components/prompt-card.js';
export * from './components/select.js';
export * from './components/settings-cards.js';
export * from './components/sheet.js';
export * from './components/side-panel.js';
export * from './components/sidebar.js';
export * from './components/team-suzie-logo.js';
export * from './components/status-dot.js';
export * from './components/switch.js';
export * from './components/table.js';
export * from './components/tabs.js';
export * from './components/context-menu.js';
export * from './components/textarea.js';
export * from './components/theme-toggle.js';
export * from './components/tool-call-card.js';
export * from './components/tool-use-status.js';
export * from './components/tooltip.js';
export * from './components/citation-chip.js';
export * from './components/cited-markdown-message.js';
export * from './components/pdf-preview.js';
export * from './components/docx-preview.js';
export * from './components/doc-find-bar.js';
export * from './components/review-grid.js';
export * from './components/column-header-editor.js';
export * from './components/redline/index.js';
export { ManifestEditor } from './components/ManifestEditor.js';
export type { ManifestEditorProps } from './components/ManifestEditor.js';
export { ManifestDiffView } from './components/ManifestDiffView.js';
export type { ManifestDiffViewProps } from './components/ManifestDiffView.js';
export { ManifestHistoryPanel } from './components/ManifestHistoryPanel.js';
export type { ManifestHistoryPanelProps, HistoryRevision } from './components/ManifestHistoryPanel.js';
export { ChatThread } from './components/chat-thread/ChatThread.js';
export { useChatThreadStream, reduceEvents } from './components/chat-thread/use-chat-thread-stream.js';
export type {
  ChatThreadProps,
  ChatThreadMessage,
  ChatToolCall,
  ChatStreamEvent,
  ChatAttachment,
} from './components/chat-thread/types.js';
