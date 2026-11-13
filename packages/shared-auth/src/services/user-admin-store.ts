import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { User } from '../models/user.js';
import { OrgInvite } from '../models/org-invite.js';
import { PasswordResetToken } from '../models/password-reset-token.js';
import { UserAccessToken } from '../models/user-access-token.js';
import type UserService from './user.js';
import { firmOrganization, setFirmMembership } from './firm.js';

export type AppRole = 'admin' | 'user';

export interface AdminUserRow {
    id: string;
    email: string;
    name: string;
    role: AppRole;
    is_active: boolean;
    created_at: string;
    last_sign_in_at: string | null;
}

export interface InviteRow {
    id: string;
    email: string;
    role: AppRole;
    expires_at: string;
    created_at: string;
    created_by_email: string;
}

export interface InviteLookup {
    invite: InviteRow;
    organizationName: string;
    state: 'open' | 'used' | 'expired' | 'revoked';
}

export interface UserAdminStore {
    listUsers(): Promise<AdminUserRow[]>;
    findUser(id: string): Promise<AdminUserRow | null>;
    findUserByEmail(email: string): Promise<AdminUserRow | null>;
    countActiveAdmins(): Promise<number>;
    createInvite(input: { email: string; role: AppRole; createdBy: string; tokenHash: string; expiresAt: Date }): Promise<InviteRow>;
    listOpenInvites(now: Date): Promise<InviteRow[]>;
    revokeInvite(id: string): Promise<boolean>;
    lookupInvite(tokenHash: string, now: Date): Promise<InviteLookup | null>;
    acceptInvite(tokenHash: string, input: { name: string; password: string }): Promise<AdminUserRow>;
    updateUser(id: string, patch: { role?: AppRole; is_active?: boolean }, by: string): Promise<AdminUserRow>;
    revokeAccessTokens(userId: string): Promise<void>;
    createResetToken(input: { userId: string; tokenHash: string; expiresAt: Date; createdBy: string }): Promise<void>;
    useResetToken(tokenHash: string, password: string, now: Date): Promise<AdminUserRow | 'invalid'>;
    deleteUser(id: string): Promise<void>;
}

function row(u: User): AdminUserRow {
    return {
        id: u.id, email: u.email, name: u.name, role: u.role as AppRole, is_active: u.is_active,
        created_at: (u as unknown as { created_at: Date }).created_at.toISOString(),
        last_sign_in_at: u.last_sign_in_at ? u.last_sign_in_at.toISOString() : null,
    };
}

function inviteRow(i: OrgInvite, createdByEmail: string): InviteRow {
    if (!i.email || !i.expires_at) throw new Error(`invite ${i.id} has no email or expiry; it was not made by the user admin routes`);
    return {
        id: i.id, email: i.email, role: i.role === 'admin' ? 'admin' : 'user', expires_at: i.expires_at.toISOString(),
        created_at: (i as unknown as { created_at: Date }).created_at.toISOString(), created_by_email: createdByEmail,
    };
}

/** Plain Sequelize calls behind firm user administration. Invite and reset tokens never reach this store; only
 *  their SHA-256 hash (`hashToken`, Task 4) does. */
export class SequelizeUserAdminStore implements UserAdminStore {
    constructor(private readonly users: UserService) {}

    async listUsers() {
        return (await User.findAll({ order: [['name', 'ASC']] })).map(row);
    }
    async findUser(id: string) {
        const u = await User.findByPk(id);
        return u ? row(u) : null;
    }
    async findUserByEmail(email: string) {
        const u = await User.findOne({ where: { email: email.toLowerCase() } });
        return u ? row(u) : null;
    }
    async countActiveAdmins() {
        return User.count({ where: { role: 'admin', is_active: true } });
    }
    async createInvite(input: { email: string; role: AppRole; createdBy: string; tokenHash: string; expiresAt: Date }) {
        const org = await firmOrganization();
        const invite = await OrgInvite.create({
            organization_id: org.id, created_by: input.createdBy, token: input.tokenHash, role: input.role,
            email: input.email, max_uses: 1, use_count: 0, expires_at: input.expiresAt, is_active: true,
        });
        const creator = await User.findByPk(input.createdBy);
        if (!creator) throw new Error(`createInvite: creator ${input.createdBy} not found`);
        return inviteRow(invite, creator.email);
    }
    async listOpenInvites(now: Date) {
        const invites = await OrgInvite.findAll({
            where: { is_active: true, use_count: 0, email: { [Op.ne]: null }, expires_at: { [Op.gt]: now } },
            include: [{ model: User, as: 'creator' }], order: [['created_at', 'DESC']],
        });
        return invites.map((i) => inviteRow(i, i.creator!.email));
    }
    async revokeInvite(id: string) {
        const [n] = await OrgInvite.update({ is_active: false }, { where: { id, is_active: true } });
        return n > 0;
    }
    async lookupInvite(tokenHash: string, now: Date): Promise<InviteLookup | null> {
        const i = await OrgInvite.findOne({ where: { token: tokenHash }, include: [{ model: User, as: 'creator' }] });
        if (!i) return null;
        const org = await firmOrganization();
        const state = !i.is_active ? 'revoked' : i.use_count >= (i.max_uses ?? 1) ? 'used'
            : i.expires_at && i.expires_at <= now ? 'expired' : 'open';
        return { invite: inviteRow(i, i.creator!.email), organizationName: org.name, state };
    }
    async acceptInvite(tokenHash: string, input: { name: string; password: string }) {
        const sequelize = User.sequelize;
        if (!sequelize) throw new Error('User model is not initialised');
        return sequelize.transaction(async (transaction) => {
            // Row lock: two clicks on the same link cannot both create an account.
            const i = await OrgInvite.findOne({ where: { token: tokenHash }, lock: transaction.LOCK.UPDATE, transaction });
            if (!i || !i.is_active || i.use_count >= (i.max_uses ?? 1) || (i.expires_at && i.expires_at <= new Date())) {
                throw Object.assign(new Error('This invite link is no longer valid'), { code: 410 });
            }
            const role: AppRole = i.role === 'admin' ? 'admin' : 'user';
            const user = await this.users.create(i.email!, input.password, input.name, role);
            await i.update({ use_count: i.use_count + 1 }, { transaction });
            await setFirmMembership(user.id, role);
            return row(user);
        });
    }
    async updateUser(id: string, patch: { role?: AppRole; is_active?: boolean }, by: string) {
        const u = await User.findByPk(id);
        if (!u) throw Object.assign(new Error('No such user'), { code: 404 });
        await u.update({ ...patch, updated_by: by });
        if (patch.role) await setFirmMembership(u.id, patch.role);
        return row(u);
    }
    async revokeAccessTokens(userId: string) {
        await UserAccessToken.update({ revoked_at: new Date() }, { where: { user_id: userId, revoked_at: null } });
    }
    async createResetToken(input: { userId: string; tokenHash: string; expiresAt: Date; createdBy: string }) {
        await PasswordResetToken.create({ user_id: input.userId, token_hash: input.tokenHash, expires_at: input.expiresAt, created_by: input.createdBy });
    }
    async useResetToken(tokenHash: string, password: string, now: Date) {
        const t = await PasswordResetToken.findOne({ where: { token_hash: tokenHash } });
        if (!t || t.used_at || t.expires_at <= now) return 'invalid' as const;
        const u = await User.findByPk(t.user_id);
        if (!u || !u.is_active) return 'invalid' as const;
        await u.update({ password_hash: await bcrypt.hash(password, 10) });
        await t.update({ used_at: now });
        return row(u);
    }
    async deleteUser(id: string) {
        const ok = await this.users.delete(id);
        if (!ok) throw Object.assign(new Error('No such user'), { code: 404 });
    }
}
