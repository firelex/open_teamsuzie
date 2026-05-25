import { useParams } from 'react-router-dom';
import { AppShellContent } from '@teamsuzie/ui';
import { resolveMattersLabel, type AgentManifest } from '../manifest/index.js';

interface Props {
    manifest: AgentManifest | null;
}

/**
 * Stub matter detail page. Documents grid + chats list + members panel
 * land in the next task.
 */
export function MatterDetailPage({ manifest }: Props) {
    const { matterId } = useParams<{ matterId: string }>();
    const label = manifest
        ? resolveMattersLabel(manifest)
        : { singular: 'Matter', plural: 'Matters' };
    return (
        <AppShellContent>
            <h1>{label.singular} detail</h1>
            <p>
                <code>{matterId}</code>
            </p>
            <p>
                Documents, members, and chats panels will appear here. APIs
                are wired at <code>/api/matters/{matterId}</code>.
            </p>
        </AppShellContent>
    );
}
