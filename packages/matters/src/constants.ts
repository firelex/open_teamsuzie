/**
 * MembersStore SubjectRef.type for matter-scoped grants. Kept as a
 * package-level constant so callers don't have to hard-code the string
 * (and so a future rename is grep-friendly).
 */
export const SUBJECT_MATTER = 'matter' as const;
