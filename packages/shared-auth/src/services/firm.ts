import type { Transaction } from 'sequelize';
import { Organization } from '../models/organization.js';
import { OrganizationMember } from '../models/organization-member.js';
import type { AppRole } from './user-admin-store.js';

const FIRM_SLUG = 'firm';

/**
 * Audit-field placeholder for rows a system process creates with no signed-in actor (e.g. the firm organisation at
 * boot). `created_by`/`updated_by` on BaseModel-derived rows carry no foreign-key constraint — they are plain UUID
 * audit columns, never dereferenced — so this is the same sentinel every app config in this codebase already uses
 * as `default_user_id` (e.g. apps/suzielaw/src/config.ts, apps/platform/auth/src/config/index.ts).
 */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The one organisation a single-firm installation keeps its people in. Created on first boot from the configured
 * firm name; later boots rename it if the configured name changed.
 */
export async function ensureFirmOrganization(name: string): Promise<{ id: string; name: string }> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('ensureFirmOrganization: the firm name is empty');
    const existing = await Organization.findOne({ where: { slug: FIRM_SLUG } });
    if (existing) {
        if (existing.name !== trimmed) await existing.update({ name: trimmed });
        return { id: existing.id, name: trimmed };
    }
    const org = await Organization.create({
        name: trimmed,
        slug: FIRM_SLUG,
        type: 'human',
        owner_id: null,
        settings: {},
        created_by: SYSTEM_USER_ID,
        updated_by: SYSTEM_USER_ID,
    });
    return { id: org.id, name: org.name };
}

/** Puts the user in the firm organisation with the organisation role matching their app role. */
export async function setFirmMembership(userId: string, role: AppRole, opts?: { transaction?: Transaction }): Promise<void> {
    const transaction = opts?.transaction;
    const org = await Organization.findOne({ where: { slug: FIRM_SLUG }, transaction });
    if (!org) throw new Error('setFirmMembership: the firm organisation does not exist; call ensureFirmOrganization at boot');
    const orgRole = role === 'admin' ? 'admin' : 'member';
    const [member] = await OrganizationMember.findOrCreate({
        where: { organization_id: org.id, user_id: userId },
        defaults: { role: orgRole, created_by: userId, updated_by: userId },
        transaction,
    });
    if (member.role !== orgRole && member.role !== 'owner') await member.update({ role: orgRole }, { transaction });
}

export async function firmOrganization(): Promise<{ id: string; name: string }> {
    const org = await Organization.findOne({ where: { slug: FIRM_SLUG } });
    if (!org) throw new Error('the firm organisation does not exist; call ensureFirmOrganization at boot');
    return { id: org.id, name: org.name };
}
