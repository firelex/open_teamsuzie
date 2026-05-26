import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { bracketMatching, indentOnInput } from '@codemirror/language';

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
