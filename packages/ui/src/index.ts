// Utility
export { cn } from './lib/utils.js';
export { humanSize, safeFilename } from './lib/format.js';
export { WHIMSICAL_VERBS, prettyToolName, summarizeArgs } from './lib/tool-display.js';

// Icons — re-exported so consumer apps don't need to declare a separate
// lucide-react dependency. Curated set; if you need an icon that isn't
// here, add it explicitly (don't `export *` — lucide has names like
// `Badge`, `Sheet`, `Table` that collide with our component exports).
export {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
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
  Inbox,
  Info,
  LayoutGrid,
  Link as LinkIcon,
  Loader2,
  LogOut,
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
export { usePersonas, useSelectedPersona } from './hooks/use-personas.js';
export type {
  Persona,
  PersonaSource,
  PersonaCreateInput,
  PersonaUpdateInput,
  UsePersonasOptions,
  UsePersonasResult,
} from './hooks/use-personas.js';
export { usePagination } from './lib/use-pagination.js';
export type {
  UsePaginationOptions,
  UsePaginationResult,
} from './lib/use-pagination.js';

// Components
export * from './components/actions-menu.js';
export * from './components/alert.js';
export * from './components/app-shell.js';
export * from './components/artifact-panel.js';
export * from './components/badge.js';
export * from './components/bulk-action-bar.js';
export * from './components/button.js';
export * from './components/card.js';
export * from './components/checkbox.js';
export * from './components/confirm-dialog.js';
export * from './components/data-table.js';
export * from './components/dialog.js';
export * from './components/dropdown-menu.js';
export * from './components/empty-state.js';
export * from './components/input.js';
export * from './components/label.js';
export * from './components/loading-state.js';
export * from './components/login-form.js';
export * from './components/markdown-message.js';
export * from './components/model-picker.js';
export * from './components/page-header.js';
export * from './components/pagination.js';
export * from './components/pending-button.js';
export * from './components/row-actions.js';
export * from './components/local-model-config-dialog.js';
export * from './components/persona-editor.js';
export * from './components/persona-picker.js';
export * from './components/prompt-card.js';
export * from './components/select.js';
export * from './components/settings-cards.js';
export * from './components/sheet.js';
export * from './components/side-panel.js';
export * from './components/sidebar.js';
export * from './components/status-dot.js';
export * from './components/switch.js';
export * from './components/table.js';
export * from './components/tabs.js';
export * from './components/context-menu.js';
export * from './components/textarea.js';
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
