import { useEffect, useState } from 'react';
import { AiFillButton, PersonaEditor, useSelectedPersona } from '@teamsuzie/ui';

/**
 * Personas — backed by the upstream `PersonaEditor` from `@teamsuzie/ui`. The
 * starter doesn't ship an avatar library; downstream apps that want one should
 * pass `availableAvatars` (see suzielaw for an example layout under
 * `client/public/avatars/`). Available tools are pulled from `/api/health`
 * so persona allow/block lists pick from the agent's live tool registry.
 *
 * The system-prompt editor in the create/edit dialog gets an `<AiFillButton>`
 * via PersonaEditor's `renderSystemPromptAiFill` render-prop slot. The slot
 * forwards the form's live `{ name, description }` so the AI-draft request
 * can ground the generated prompt on what the user has typed so far.
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
      renderSystemPromptAiFill={({ name, description, setSystemPrompt }) => (
        <AiFillButton
          kind="persona-system"
          context={{ name, description }}
          onFill={(text) => setSystemPrompt(text)}
          disabled={!name.trim()}
        />
      )}
    />
  );
}
