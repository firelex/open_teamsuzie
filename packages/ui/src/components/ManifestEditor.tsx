import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { bracketMatching, indentOnInput } from '@codemirror/language';

// Inline theme. CodeMirror ships no defaults; without this the editor renders
// dark-on-dark inside any overlay whose host palette is dark.
// Pulls from CSS variables when present so the editor blends with the host;
// fallbacks ensure legibility against any background.
const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    color: 'var(--foreground, #e6e6e6)',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  '.cm-content': {
    color: 'var(--foreground, #e6e6e6)',
    caretColor: 'var(--primary, #f4b400)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--primary, #f4b400)' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--muted-foreground, #888)',
    border: 'none',
  },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(122,24,32,0.4) !important' },
  '.cm-tooltip': {
    backgroundColor: 'var(--panel, #1a1a1a)',
    border: '1px solid var(--border, #333)',
    color: 'var(--foreground, #e6e6e6)',
  },
  '.cm-tooltip-lint': { padding: '4px 6px' },
  '.cm-diagnostic': { color: 'var(--foreground, #e6e6e6)' },
  '.cm-diagnostic-error': { borderLeft: '3px solid #f85149' },
  // JSON syntax colors — pick values that contrast against typical dark themes.
  '.tok-propertyName': { color: '#9cdcfe' },
  '.tok-string': { color: '#ce9178' },
  '.tok-number': { color: '#b5cea8' },
  '.tok-bool, .tok-atom, .tok-keyword': { color: '#569cd6' },
  '.tok-null': { color: '#569cd6' },
  '.tok-punctuation': { color: 'var(--muted-foreground, #888)' },
}, { dark: true });

export interface ManifestEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Called with the trimmed buffer when the user invokes Save (Cmd/Ctrl+S). */
  onSave?: (current: string) => void;
  /**
   * Validate a candidate buffer. Returning a non-empty array surfaces gutter
   * markers. Caller controls schema (typically `validateManifest`).
   */
  validate?: (current: string) => { from?: number; to?: number; message: string; severity?: 'error' | 'warning' }[];
  className?: string;
  height?: string;
}

export function ManifestEditor(props: ManifestEditorProps) {
  const { value, onChange, onSave, validate, className, height = '70vh' } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const validateRef = useRef(validate);
  validateRef.current = validate;

  useEffect(() => {
    if (!hostRef.current) return;

    const validateExt = linter((view) => {
      const fn = validateRef.current;
      if (!fn) return [];
      const issues = fn(view.state.doc.toString());
      return issues.map<Diagnostic>((i) => ({
        from: i.from ?? 0,
        to: i.to ?? view.state.doc.length,
        message: i.message,
        severity: i.severity ?? 'error',
      }));
    });

    const saveKey = keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: (view) => {
          onSaveRef.current?.(view.state.doc.toString());
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: value,
      extensions: [
        editorTheme,
        lineNumbers(),
        highlightActiveLine(),
        bracketMatching(),
        indentOnInput(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        saveKey,
        json(),
        lintGutter(),
        validateExt,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const next = update.state.doc.toString();
            if (next !== valueRef.current) onChangeRef.current(next);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div ref={hostRef} className={className} style={{ height, overflow: 'auto' }} />;
}
