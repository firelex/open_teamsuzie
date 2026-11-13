import * as React from 'react';
import { MoreHorizontal, Trash2, Edit, Eye, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './dropdown-menu';
import { useUiT } from '../lib/i18n.js';

export interface ActionItem {
    /** Unique key for the action */
    key: string;
    /** Display label */
    label: string;
    /** Icon component */
    icon?: React.ReactNode;
    /** Click handler */
    onClick: () => void;
    /** Whether this is a destructive action (shown in red) */
    destructive?: boolean;
    /** Whether the action is disabled */
    disabled?: boolean;
}

export interface ActionsMenuProps {
    /** Array of action items to display */
    actions: ActionItem[];
    /** Additional className for the trigger button */
    className?: string;
    /** Button size */
    size?: 'sm' | 'default' | 'lg' | 'icon';
    /** Button variant */
    variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive' | 'link';
    /** Alignment of the dropdown */
    align?: 'start' | 'center' | 'end';
}

/**
 * A standardized actions dropdown menu with the "three dots" pattern.
 * Use this for row-level actions in tables and lists.
 *
 * @example
 * ```tsx
 * <ActionsMenu
 *   actions={[
 *     { key: 'edit', label: 'Edit', icon: <Edit className="h-4 w-4" />, onClick: handleEdit },
 *     { key: 'delete', label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onClick: handleDelete, destructive: true },
 *   ]}
 * />
 * ```
 */
export function ActionsMenu({
    actions,
    className,
    size = 'sm',
    variant = 'outline',
    align = 'end',
}: ActionsMenuProps) {
    const { t } = useUiT();
    // Separate destructive actions to show after separator
    const regularActions = actions.filter((a) => !a.destructive);
    const destructiveActions = actions.filter((a) => a.destructive);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant={variant}
                    size={size}
                    className={cn('h-8 w-8 p-0', className)}
                    aria-label={t('actionsMenu.openActionsMenu')}
                >
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={align}>
                {regularActions.map((action) => (
                    <DropdownMenuItem
                        key={action.key}
                        onSelect={() => action.onClick()}
                        disabled={action.disabled}
                    >
                        {action.icon && <span className="mr-2">{action.icon}</span>}
                        {action.label}
                    </DropdownMenuItem>
                ))}
                {regularActions.length > 0 && destructiveActions.length > 0 && (
                    <DropdownMenuSeparator />
                )}
                {destructiveActions.map((action) => (
                    <DropdownMenuItem
                        key={action.key}
                        onSelect={() => action.onClick()}
                        disabled={action.disabled}
                        variant="destructive"
                    >
                        {action.icon && <span className="mr-2">{action.icon}</span>}
                        {action.label}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

// Pre-built action helpers for common patterns
export const createEditAction = (onClick: () => void, label = 'Edit'): ActionItem => ({
    key: 'edit',
    label,
    icon: <Edit className="h-4 w-4" />,
    onClick,
});

export const createViewAction = (onClick: () => void, label = 'View'): ActionItem => ({
    key: 'view',
    label,
    icon: <Eye className="h-4 w-4" />,
    onClick,
});

export const createDeleteAction = (onClick: () => void, label = 'Delete'): ActionItem => ({
    key: 'delete',
    label,
    icon: <Trash2 className="h-4 w-4" />,
    onClick,
    destructive: true,
});

export const createMembersAction = (onClick: () => void, label = 'Members'): ActionItem => ({
    key: 'members',
    label,
    icon: <Users className="h-4 w-4" />,
    onClick,
});
