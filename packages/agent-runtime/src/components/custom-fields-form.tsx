import {
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
} from '@teamsuzie/ui';
import type { ManifestCustomField } from '../manifest/index.js';

interface CustomFieldsFormProps {
    fields: ManifestCustomField[];
    values: Record<string, unknown>;
    onChange: (key: string, value: unknown) => void;
    errors?: Record<string, string>;
    disabled?: boolean;
    /** Optional prefix added to input id attributes — useful when the form
     *  is rendered twice on the same page (create + edit) to avoid id collisions. */
    idPrefix?: string;
}

/**
 * Renders one input per custom field from a ManifestMatterType. The
 * component is stateless — the caller owns `values` and `errors` and
 * updates via the `onChange(key, value)` callback. That lets the parent
 * (the create dialog or the edit dialog) run validation, surface
 * per-field errors, and decide when to call PUT /metadata.
 */
export function CustomFieldsForm({
    fields,
    values,
    onChange,
    errors,
    disabled,
    idPrefix = 'cf',
}: CustomFieldsFormProps) {
    if (fields.length === 0) return null;
    return (
        <div className="space-y-4">
            {fields.map((field) => {
                const inputId = `${idPrefix}-${field.key}`;
                const value = values[field.key];
                const error = errors?.[field.key];
                return (
                    <div key={field.key} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                            <Label htmlFor={inputId}>
                                {field.label}
                                {field.required ? (
                                    <span
                                        className="ml-1 text-destructive"
                                        aria-label="required"
                                    >
                                        *
                                    </span>
                                ) : null}
                            </Label>
                        </div>
                        {renderInput(field, value, onChange, inputId, disabled)}
                        {field.description && (
                            <p className="text-xs text-muted-foreground">
                                {field.description}
                            </p>
                        )}
                        {error && (
                            <p className="text-xs text-destructive">{error}</p>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function renderInput(
    field: ManifestCustomField,
    value: unknown,
    onChange: (key: string, value: unknown) => void,
    inputId: string,
    disabled?: boolean,
) {
    switch (field.type) {
        case 'text':
            return (
                <Input
                    id={inputId}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(field.key, e.target.value)}
                    disabled={disabled}
                />
            );
        case 'number':
            return (
                <Input
                    id={inputId}
                    type="number"
                    value={
                        typeof value === 'number' || typeof value === 'string'
                            ? String(value)
                            : ''
                    }
                    onChange={(e) => onChange(field.key, e.target.value)}
                    disabled={disabled}
                />
            );
        case 'date':
            return (
                <Input
                    id={inputId}
                    type="date"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(field.key, e.target.value)}
                    disabled={disabled}
                />
            );
        case 'enum': {
            const options = field.options ?? [];
            return (
                <Select
                    value={typeof value === 'string' ? value : ''}
                    onValueChange={(v) => onChange(field.key, v)}
                    disabled={disabled}
                >
                    <SelectTrigger id={inputId}>
                        <SelectValue placeholder="Pick a value…" />
                    </SelectTrigger>
                    <SelectContent>
                        {options.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                                {opt}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
        }
        case 'boolean':
            return (
                <Switch
                    id={inputId}
                    checked={value === true}
                    onCheckedChange={(checked) => onChange(field.key, checked)}
                    disabled={disabled}
                />
            );
    }
}
