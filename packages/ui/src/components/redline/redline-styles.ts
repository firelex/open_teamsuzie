/**
 * Amber pulse used by <RedlinePanelContent> + <TrackedChangesPanel> when
 * focusing a card or revision span via window event sync. Injected as a
 * <style> tag on first import so the redline components work without
 * requiring the consumer to wire a separate stylesheet — the @teamsuzie/ui
 * package builds with tsc (no CSS bundler), so we can't `import './x.css'`.
 */
const STYLE_ID = 'teamsuzie-redline-flash';

const CSS = `
@keyframes redline-flash {
  0%   { background-color: rgba(245, 158, 11, 0.45); }
  60%  { background-color: rgba(245, 158, 11, 0.18); }
  100% { background-color: rgba(245, 158, 11, 0); }
}
.redline-flash {
  animation: redline-flash 1.2s ease-out;
}
`;

let injected = false;

export function ensureRedlineStyles(): void {
  if (injected) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) {
    injected = true;
    return;
  }
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
  injected = true;
}
