import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@teamsuzie/ui';

import type { ModelInfo } from './api.js';

export interface ModelPickerProps {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
  testid?: string;
}

/**
 * Model selector. Unavailable models (no key / unreachable) stay in the list but
 * are disabled, with the reason shown inline — the picker never hides *why* a
 * model can't be used.
 */
export function ModelPicker({ models, value, onChange, testid }: ModelPickerProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={testid} className="w-80">
        <SelectValue placeholder="Select a model" />
      </SelectTrigger>
      <SelectContent>
        {models.map((m) => (
          <SelectItem key={m.id} value={m.id} disabled={!m.available}>
            {m.label}
            {m.deployment === 'local' ? ' (local)' : ''}
            {m.available ? '' : ` — ${m.reason ?? 'unavailable'}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
