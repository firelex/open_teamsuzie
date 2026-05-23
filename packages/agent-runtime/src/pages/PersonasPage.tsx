import { useEffect, useState } from 'react';
import { PersonaEditor, useSelectedPersona } from '@teamsuzie/ui';

/**
 * Personas — backed by the upstream `PersonaEditor` from `@teamsuzie/ui`. The
 * starter doesn't ship an avatar library; downstream apps that want one should
 * pass `availableAvatars` (see suzielaw for an example layout under
 * `client/public/avatars/`). Available tools are pulled from `/api/health`
 * so persona allow/block lists pick from the agent's live tool registry.
 */
interface ToolEntry { name: string; description?: string }
interface HealthResponse { tools?: ToolEntry[] }

export function PersonasPage() {
  const [selectedPersonaId, setSelectedPersonaId] = useSelectedPersona(
    'counsel:selected-persona',
  );
  const [tools, setTools] = useState<ToolEntry[]>([]);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<HealthResponse>)
      .then((d) => setTools(d.tools ?? []))
      .catch(() => undefined);
  }, []);

  return (
    <PersonaEditor
      availableTools={tools}
      selectedPersonaId={selectedPersonaId}
      onSelect={setSelectedPersonaId}
    />
  );
}
