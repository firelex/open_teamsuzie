import { useEffect, useState } from 'react';
import { ManifestDiffView } from './ManifestDiffView';

export interface HistoryRevision {
  ts: string;
  label: string;
  sourceKind: 'initial' | 'nl-patch' | 'json-editor' | 'revert';
}

export interface ManifestHistoryPanelProps {
  revisions: HistoryRevision[];
  /** Fetcher for a specific revision body. Caller wires this to the backend. */
  fetchRevision: (ts: string) => Promise<string>;
  /** Current on-disk manifest body, used as the right side of the diff. */
  currentManifest: string;
  /** Caller invokes the revert RPC and refreshes revisions list. */
  onRevert: (ts: string) => Promise<void>;
  className?: string;
}

export function ManifestHistoryPanel(props: ManifestHistoryPanelProps) {
  const { revisions, fetchRevision, currentManifest, onRevert, className } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const [body, setBody] = useState<string>('');

  useEffect(() => {
    if (!selected) { setBody(''); return; }
    let cancelled = false;
    void fetchRevision(selected).then((b) => { if (!cancelled) setBody(b); });
    return () => { cancelled = true; };
  }, [selected, fetchRevision]);

  return (
    <div className={className} style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 240, borderRight: '1px solid var(--border, #2a2a2a)', overflow: 'auto' }}>
        {revisions.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, opacity: 0.6 }}>No revisions yet.</div>
        )}
        {revisions.map((r) => (
          <button
            key={r.ts}
            onClick={() => setSelected(r.ts)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              background: selected === r.ts ? 'rgba(255,255,255,0.05)' : 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--border, #2a2a2a)',
              color: 'inherit',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: 11,
            }}
          >
            <div style={{ opacity: 0.6 }}>{r.ts}</div>
            <div>{r.label}</div>
            <div style={{ opacity: 0.5, fontSize: 10 }}>{r.sourceKind}</div>
          </button>
        ))}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selected ? (
          <>
            <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border, #2a2a2a)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, opacity: 0.7 }}>{selected}</span>
              <button
                onClick={() => { void onRevert(selected); }}
                style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
              >
                Revert to this
              </button>
            </div>
            <ManifestDiffView before={body} after={currentManifest} beforeLabel={selected} afterLabel="current" />
          </>
        ) : (
          <div style={{ padding: 16, fontSize: 12, opacity: 0.6 }}>Pick a revision to diff against the current manifest.</div>
        )}
      </div>
    </div>
  );
}
