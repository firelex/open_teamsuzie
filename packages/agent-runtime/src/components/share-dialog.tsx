import { useState, type FormEvent } from 'react';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    LoadingState,
    PendingButton,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Trash2,
    cn,
} from '@teamsuzie/ui';
import {
    useMembers,
    type MemberRole,
    type MemberSubject,
} from '../hooks/use-members.js';

interface ShareDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    subject: MemberSubject | null;
    /** Display name for the subject — shown in the dialog title. */
    subjectName: string;
    /** Subject noun for copy: "matter", "deal", "case", etc. */
    subjectNoun: string;
}

const ROLE_OPTIONS: { value: MemberRole; label: string; hint: string }[] = [
    { value: 'viewer', label: 'Viewer', hint: 'Can view and run; cannot edit.' },
    { value: 'editor', label: 'Editor', hint: 'Can view, run, and edit.' },
    {
        value: 'owner',
        label: 'Owner',
        hint: 'Full control, including sharing and deletion.',
    },
];

function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

/**
 * Shared share-management dialog for any subject the `members` table
 * tracks. Owners can add/remove; viewers/editors see a read-only list.
 *
 * Ported from suzielaw's components/share-dialog.tsx, narrowed to the
 * matter subject for now — workflow membership is not yet upstream.
 */
export function ShareDialog({
    open,
    onOpenChange,
    subject,
    subjectName,
    subjectNoun,
}: ShareDialogProps) {
    const { members, role, loading, error, add, remove } = useMembers(
        subject,
        open,
    );
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<MemberRole>('viewer');
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const canMutate = role === 'owner';

    async function handleAdd(event: FormEvent) {
        event.preventDefault();
        setFormError(null);
        const trimmed = inviteEmail.trim().toLowerCase();
        if (!trimmed) {
            setFormError('Enter an email address.');
            return;
        }
        if (!trimmed.includes('@')) {
            setFormError('Enter a valid email address.');
            return;
        }
        setSubmitting(true);
        try {
            await add({ email: trimmed, role: inviteRole });
            setInviteEmail('');
            setInviteRole('viewer');
        } catch (err) {
            setFormError(
                err instanceof Error
                    ? err.message
                    : 'Failed to add member',
            );
        } finally {
            setSubmitting(false);
        }
    }

    async function handleRemove(userId: string) {
        setFormError(null);
        try {
            await remove(userId);
        } catch (err) {
            setFormError(
                err instanceof Error
                    ? err.message
                    : 'Failed to remove member',
            );
        }
    }

    const sortedMembers = [...members].sort((a, b) => {
        const rankA =
            a.role === 'owner' ? 0 : a.role === 'editor' ? 1 : 2;
        const rankB =
            b.role === 'owner' ? 0 : b.role === 'editor' ? 1 : 2;
        if (rankA !== rankB) return rankA - rankB;
        return b.grantedAt - a.grantedAt;
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Share &ldquo;{subjectName}&rdquo;</DialogTitle>
                    <DialogDescription>
                        {canMutate
                            ? `Invite collaborators to this ${subjectNoun}. They'll see it in their workspace when they log in.`
                            : `You have ${role ?? 'no'} access to this ${subjectNoun}. Only owners can change who has access.`}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    {canMutate && (
                        <form className="space-y-1.5" onSubmit={handleAdd}>
                            <Label htmlFor="share-email">Add by email</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="share-email"
                                    type="email"
                                    value={inviteEmail}
                                    onChange={(e) =>
                                        setInviteEmail(e.target.value)
                                    }
                                    placeholder="colleague@firm.com"
                                    disabled={submitting}
                                    autoComplete="email"
                                />
                                <Select
                                    value={inviteRole}
                                    onValueChange={(v) =>
                                        setInviteRole(v as MemberRole)
                                    }
                                    disabled={submitting}
                                >
                                    <SelectTrigger className="w-[120px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {ROLE_OPTIONS.map((r) => (
                                            <SelectItem
                                                key={r.value}
                                                value={r.value}
                                            >
                                                {r.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <PendingButton
                                    type="submit"
                                    pending={submitting}
                                    pendingLabel="Adding"
                                >
                                    Add
                                </PendingButton>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {
                                    ROLE_OPTIONS.find(
                                        (r) => r.value === inviteRole,
                                    )?.hint
                                }
                            </p>
                            {formError && (
                                <p className="text-xs text-destructive">
                                    {formError}
                                </p>
                            )}
                        </form>
                    )}

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Label>People with access</Label>
                            <span className="text-xs text-muted-foreground">
                                {sortedMembers.length}{' '}
                                {sortedMembers.length === 1
                                    ? 'person'
                                    : 'people'}
                            </span>
                        </div>
                        {error && (
                            <p className="text-xs text-destructive">{error}</p>
                        )}
                        {loading ? (
                            <LoadingState>Loading members…</LoadingState>
                        ) : sortedMembers.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                No members yet.
                            </p>
                        ) : (
                            <ul className="divide-y rounded-md border">
                                {sortedMembers.map((m) => {
                                    const isOnlyOwner =
                                        m.role === 'owner' &&
                                        sortedMembers.filter(
                                            (x) => x.role === 'owner',
                                        ).length === 1;
                                    const removeDisabled =
                                        !canMutate || isOnlyOwner;
                                    return (
                                        <li
                                            key={m.id}
                                            className="flex items-center gap-3 px-3 py-2"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium">
                                                    {m.userId}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {m.role
                                                        .charAt(0)
                                                        .toUpperCase() +
                                                        m.role.slice(1)}{' '}
                                                    · added{' '}
                                                    {formatDate(m.grantedAt)}
                                                </p>
                                            </div>
                                            {canMutate && (
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    aria-label={`Remove ${m.userId}`}
                                                    disabled={removeDisabled}
                                                    title={
                                                        isOnlyOwner
                                                            ? 'Cannot remove the last owner'
                                                            : `Remove ${m.userId}`
                                                    }
                                                    onClick={() =>
                                                        void handleRemove(
                                                            m.userId,
                                                        )
                                                    }
                                                    className={cn(
                                                        'size-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive',
                                                        removeDisabled &&
                                                            'opacity-50',
                                                    )}
                                                >
                                                    <Trash2
                                                        className="size-4"
                                                        aria-hidden
                                                    />
                                                </Button>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
