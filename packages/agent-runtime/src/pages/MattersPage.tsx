import { AppShellContent } from '@teamsuzie/ui';
import { resolveMattersLabel, type AgentManifest } from '../manifest/index.js';

interface Props {
    manifest: AgentManifest | null;
}

/**
 * Stub Matters list. Will be replaced with the suzielaw-ported list +
 * create + share-dialog surface in the next task.
 */
export function MattersPage({ manifest }: Props) {
    const label = manifest
        ? resolveMattersLabel(manifest)
        : { singular: 'Matter', plural: 'Matters' };
    return (
        <AppShellContent>
            <h1>{label.plural}</h1>
            <p>
                The {label.plural.toLowerCase()} list will appear here once the
                full page lands. The route is mounted; the API is wired at{' '}
                <code>/api/matters</code>.
            </p>
        </AppShellContent>
    );
}
