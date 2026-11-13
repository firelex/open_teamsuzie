import bcrypt from 'bcryptjs';
import { Op, type Transaction } from 'sequelize';
import { User } from '../models/user.js';
import { UserAccessToken } from '../models/user-access-token.js';
import { OAuthAccount } from '../models/oauth-account.js';
import { Notification } from '../models/notification.js';
import { OrganizationMember } from '../models/organization-member.js';
import { PendingMembership } from '../models/pending-membership.js';
import { UserDevice } from '../models/user-device.js';
import { Agent } from '../models/agent.js';
import { OrgInvite } from '../models/org-invite.js';
import { PasswordResetToken } from '../models/password-reset-token.js';
import type { SharedAuthConfig } from '../types.js';
import { generateApiKey, verifyApiKey } from '../utils/encryption.js';
import { emailMatches } from '../utils/email.js';

export default class UserService {

    private config: SharedAuthConfig;

    constructor(config: SharedAuthConfig) {
        this.config = config;
    }

    create = async (
        email: string,
        password: string,
        name: string,
        role: 'admin' | 'user' = 'user',
        opts?: { transaction?: Transaction },
    ): Promise<User> => {
        email = email.trim().toLowerCase();
        // Ignoring capitals: an older account stored as `Bob@Firm.com` is the same person as `bob@firm.com`.
        const existingUser = await User.findOne({ where: emailMatches(email), transaction: opts?.transaction });
        if (existingUser) {
            throw Object.assign(new Error('User with this email already exists'), { code: 400 });
        }

        const password_hash = await bcrypt.hash(password, 10);

        const user = await User.create({
            email,
            name,
            password_hash,
            role,
            created_by: this.config.default_user_id,
            updated_by: this.config.default_user_id
        }, { transaction: opts?.transaction });

        return user;
    }

    authenticate = async (email: string, password: string): Promise<User | null> => {
        // Ignoring capitals: older accounts may be stored with the capitals they were created with.
        const user = await User.findOne({ where: emailMatches(email) });
        if (!user) return null;

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return null;
        // Checked after the password, so the answer never reveals that an address has an account.
        if (!user.is_active) {
            throw Object.assign(new Error('This account has been deactivated'), { code: 403 });
        }

        user.last_sign_in_at = new Date();
        await user.save();
        return user;
    }

    /**
     * Sign in the local account an external password check vouched for (SharedAuthConfig.externalPasswords):
     * refused when it has no account here or the account is deactivated.
     */
    signInExternal = async (email: string): Promise<User> => {
        const user = await User.findOne({ where: emailMatches(email) });
        if (!user) throw Object.assign(new Error(`The external password check named ${email}, which has no account here`), { code: 500 });
        if (!user.is_active) throw Object.assign(new Error('This account has been deactivated'), { code: 403 });
        user.last_sign_in_at = new Date();
        await user.save();
        return user;
    };

    createAccessToken = async (
        userId: string,
        name = 'app-client',
        expiresInDays: number | null = 30,
    ): Promise<{ token: string; accessToken: UserAccessToken }> => {
        const user = await User.findByPk(userId);
        if (!user) {
            throw Object.assign(new Error('User not found'), { code: 404 });
        }

        const { key, prefix, hash } = generateApiKey('tsu');
        const expires_at =
            expiresInDays && expiresInDays > 0
                ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
                : null;

        const accessToken = await UserAccessToken.create({
            user_id: user.id,
            name,
            token_hash: hash,
            token_prefix: prefix,
            expires_at,
            created_by: user.id,
            updated_by: user.id
        });

        return { token: key, accessToken };
    }

    authenticateAccessToken = async (providedToken: string): Promise<{
        user: User;
        accessToken: UserAccessToken;
    } | null> => {
        if (!providedToken || !providedToken.startsWith('tsu_')) {
            return null;
        }

        const tokenPrefix = providedToken.substring(0, 12);
        const candidates = await UserAccessToken.findAll({
            where: {
                token_prefix: tokenPrefix,
                revoked_at: null
            },
            include: [User]
        });

        const now = new Date();
        for (const candidate of candidates) {
            if (candidate.expires_at && candidate.expires_at.getTime() <= now.getTime()) {
                continue;
            }

            if (!verifyApiKey(providedToken, candidate.token_hash)) {
                continue;
            }

            candidate.last_seen_at = now;
            candidate.updated_by = candidate.user_id;
            await candidate.save();

            if (!candidate.user) {
                continue;
            }

            if (!candidate.user.is_active) {
                return null;
            }

            return { user: candidate.user, accessToken: candidate };
        }

        return null;
    }

    listAccessTokens = async (userId: string): Promise<Array<{
        id: string;
        name: string;
        token_prefix: string;
        last_seen_at: Date | null;
        expires_at: Date | null;
        revoked_at: Date | null;
        created_at: Date;
    }>> => {
        const tokens = await UserAccessToken.findAll({
            where: { user_id: userId },
            order: [['created_at', 'DESC']]
        });

        return tokens.map((token) => ({
            id: token.id,
            name: token.name,
            token_prefix: token.token_prefix,
            last_seen_at: token.last_seen_at,
            expires_at: token.expires_at,
            revoked_at: token.revoked_at,
            created_at: token.created_at
        }));
    }

    revokeAccessToken = async (userId: string, tokenId: string): Promise<boolean> => {
        const token = await UserAccessToken.findOne({
            where: { id: tokenId, user_id: userId, revoked_at: null }
        });

        if (!token) {
            return false;
        }

        token.revoked_at = new Date();
        token.updated_by = userId;
        await token.save();
        return true;
    }

    /**
     * Permanently delete a user and the rows that only make sense with them:
     * access tokens, linked OAuth accounts, notifications, organisation
     * memberships, pending memberships, devices, password reset tokens (as
     * the target or as the admin who created them) and invites the user
     * created. Refuses (throws) when the user still owns agents, which must
     * be reassigned or deleted first. Returns false when no such user exists.
     *
     * Runs in one transaction. Pass `opts.transaction` to run inside a
     * transaction the caller already opened (e.g. one that is also
     * enforcing the last-active-admin rule on the same rows) instead of
     * opening a second, nested one; every query below then uses it.
     * Without it, this opens its own transaction as before.
     */
    delete = async (userId: string, opts?: { transaction?: Transaction }): Promise<boolean> => {
        const outerTransaction = opts?.transaction;
        const user = await User.findByPk(userId, { transaction: outerTransaction });
        if (!user) return false;
        const agents = User.sequelize?.models[Agent.name]
            ? await Agent.count({ where: { user_id: userId }, transaction: outerTransaction })
            : 0;
        if (agents > 0) {
            throw Object.assign(
                new Error(`User owns ${agents} agent(s); reassign or delete them before deleting the user`),
                { code: 409 },
            );
        }
        const sequelize = User.sequelize;
        if (!sequelize) throw new Error('User model is not initialised');
        // Apps register only the models they use; a model that is not
        // registered has no table here, so there is nothing to delete in it.
        const registered = (model: { name: string }) => Boolean(sequelize.models[model.name]);
        const run = async (transaction: Transaction) => {
            if (registered(UserAccessToken)) await UserAccessToken.destroy({ where: { user_id: userId }, transaction });
            if (registered(OAuthAccount)) {
                await OAuthAccount.destroy({ where: { owner_type: 'user', owner_id: userId }, transaction });
            }
            if (registered(Notification)) await Notification.destroy({ where: { user_id: userId }, transaction });
            if (registered(OrganizationMember)) {
                await OrganizationMember.destroy({ where: { user_id: userId }, transaction });
            }
            if (registered(PendingMembership)) {
                await PendingMembership.destroy({ where: { user_id: userId }, transaction });
            }
            if (registered(UserDevice)) await UserDevice.destroy({ where: { user_id: userId }, transaction });
            if (registered(PasswordResetToken)) {
                // The user is either the token's target (user_id) or the admin who created it (created_by);
                // both are NOT NULL foreign keys into users, so either role blocks the delete if left behind.
                await PasswordResetToken.destroy({
                    where: { [Op.or]: [{ user_id: userId }, { created_by: userId }] },
                    transaction,
                });
            }
            if (registered(OrgInvite)) {
                // created_by is a NOT NULL foreign key into users; an invite this user created must go too.
                await OrgInvite.destroy({ where: { created_by: userId }, transaction });
            }
            await user.destroy({ transaction });
        };
        if (outerTransaction) {
            await run(outerTransaction);
        } else {
            await sequelize.transaction(run);
        }
        return true;
    };

    findById = async (id: string): Promise<User | null> => {
        return User.findByPk(id);
    }

    findByEmail = async (email: string): Promise<{ id: string; email: string; name: string; role: string } | null> => {
        const user = await User.findOne({ where: emailMatches(email), attributes: ['id', 'email', 'name', 'role'] });
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role };
    }

    findAll = async (): Promise<{ users: { id: string; name: string; role: string }[] }> => {
        const users = await User.findAll({
            attributes: ['id', 'name', 'role', 'email'],
            order: [['name', 'ASC']]
        });
        const filteredUsers = users.filter(u =>
            u.role !== 'admin' &&
            u.email.toLowerCase() !== 'admin'
        );
        return { users: filteredUsers.map(u => ({ id: u.id, name: u.name, role: u.role })) };
    }
}
