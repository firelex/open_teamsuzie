import type { ReactNode } from 'react';
import { RecordDetailLayout } from '@teamsuzie/ui';
import { testid } from '../lib/testids';

export interface RecordWorkspaceProps {
  /** Record title bar / breadcrumb — typically a PageHeader. */
  header?: ReactNode;
  /** Right-hand property panel (e.g. a PropertyPanel of record fields). */
  sidebar?: ReactNode;
  /** The tabbed body of the record (the object workspace tabs). */
  children: ReactNode;
}

/**
 * Canonical "record / object workspace" archetype: a RecordDetailLayout with a
 * header, a property-panel sidebar, and a tabbed body. The build agent supplies
 * the object's tabs (from layout.json) and field panel; the frame is fixed.
 */
export function RecordWorkspace({ header, sidebar, children }: RecordWorkspaceProps) {
  return (
    <RecordDetailLayout data-testid={testid.recordWorkspace} header={header} sidebar={sidebar}>
      {children}
    </RecordDetailLayout>
  );
}
