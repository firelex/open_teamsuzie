import { useMemo } from 'react';
import { diffLines } from 'diff';

export interface ManifestDiffViewProps {
  before: string;
  after: string;
  /** Optional labels rendered in the header. */
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}

interface Line {
  kind: 'add' | 'remove' | 'context';
  text: string;
}

function buildLines(before: string, after: string): Line[] {
  const parts = diffLines(before, after);
  const out: Line[] = [];
  for (const part of parts) {
    const lines = part.value.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      out.push({
        kind: part.added ? 'add' : part.removed ? 'remove' : 'context',
        text: line,
      });
    }
  }
  return out;
}

export function ManifestDiffView(props: ManifestDiffViewProps) {
  const { before, after, beforeLabel = 'before', afterLabel = 'after', className } = props;
  const lines = useMemo(() => buildLines(before, after), [before, after]);
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', fontFamily: 'monospace', fontSize: 11, opacity: 0.7, padding: '4px 8px' }}>
        <span style={{ flex: 1 }}>{beforeLabel}</span>
        <span style={{ flex: 1 }}>{afterLabel}</span>
      </div>
      <pre
        style={{
          flex: 1,
          margin: 0,
          padding: '8px 12px',
          fontFamily: 'monospace',
          fontSize: 12,
          overflow: 'auto',
          background: 'transparent',
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              background:
                line.kind === 'add' ? 'rgba(46,160,67,0.18)' :
                line.kind === 'remove' ? 'rgba(248,81,73,0.18)' :
                'transparent',
              whiteSpace: 'pre',
            }}
          >
            <span style={{ display: 'inline-block', width: 14, opacity: 0.6 }}>
              {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
            </span>
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
