import type { Request, Response } from 'express';
import { Organization } from '../models/organization.js';
import { OrganizationMember } from '../models/organization-member.js';
import { OrgDomain } from '../models/org-domain.js';
import { User } from '../models/user.js';
import RedisService from '../services/redis.js';
import { SessionTracker } from '../services/session-tracker.js';
import UserService from '../services/user.js';
import type { SharedAuthConfig } from '../types.js';
import { checkRegistration, type RegistrationPolicy } from '../utils/registration.js';

const PUBLIC_EMAIL_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
    'yahoo.com', 'yahoo.co.uk', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
    'protonmail.com', 'proton.me', 'mail.com', 'zoho.com', 'yandex.com',
    'gmx.com', 'gmx.net', 'fastmail.com',
]);

export default class AuthController {

    private userService: UserService;
    private registration: RegistrationPolicy | undefined;
    private config: SharedAuthConfig;
    private sessionTracker: SessionTracker | undefined;

    constructor(config: SharedAuthConfig) {
        this.userService = new UserService(config);
        this.registration = config.registration;
        this.config = config;
    }

    /**
     * Built lazily on first use, not in the constructor, so constructing AuthController never opens a Redis
     * connection (tests construct it freely without a live Redis).
     */
    private get sessions(): SessionTracker {
        if (!this.sessionTracker) {
            this.sessionTracker = new SessionTracker(new RedisService(this.config).getClient(), this.config.redis.key_prefix);
        }
        return this.sessionTracker;
    }

    /** For tests: inject a SessionTracker backed by an in-memory store instead of the lazily-created Redis one. */
    setSessionTracker(tracker: SessionTracker): void {
        this.sessionTracker = tracker;
    }

    private extractBearerToken(req: Request): string | null {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return null;
        }

        const token = authHeader.slice(7).trim();
        return token || null;
    }

    private serializeUser(user: User | { id: string; email: string; name: string; role: string }) {
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role
        };
    }

    private async getAuthenticatedUser(req: Request): Promise<{
        user: User | { id: string; email: string; name: string; role: string };
        auth_type: 'session' | 'bearer';
        token_id?: string;
    } | null> {
        const session = req.session as any;
        if (session.userId) {
            const user = await this.userService.findById(session.userId);
            if (!user || !(user as User).is_active) {
                return null;
            }

            return {
                user,
                auth_type: 'session'
            };
        }

        const token = this.extractBearerToken(req);
        if (!token) {
            return null;
        }

        const result = await this.userService.authenticateAccessToken(token);
        if (!result) {
            return null;
        }

        return {
            user: result.user,
            auth_type: 'bearer',
            token_id: result.accessToken.id
        };
    }

    private async buildTokenResponse(userId: string, req: Request): Promise<{
        access_token: string;
        token_type: 'Bearer';
        expires_at: string | null;
        token_name: string;
    } | null> {
        if (req.body?.issue_bearer_token !== true) {
            return null;
        }

        const tokenName = String(req.body?.token_name || req.headers['x-client-name'] || 'app-client').trim() || 'app-client';
        const expiresInDaysRaw = req.body?.expires_in_days;
        const expiresInDays =
            expiresInDaysRaw === null || expiresInDaysRaw === undefined || expiresInDaysRaw === ''
                ? 30
                : Number(expiresInDaysRaw);

        const { token, accessToken } = await this.userService.createAccessToken(
            userId,
            tokenName,
            Number.isFinite(expiresInDays) ? expiresInDays : 30,
        );

        return {
            access_token: token,
            token_type: 'Bearer',
            expires_at: accessToken.expires_at ? accessToken.expires_at.toISOString() : null,
            token_name: accessToken.name
        };
    }

    private async ensureHumanWorkspace(user: User): Promise<void> {
        const memberships = await OrganizationMember.findAll({
            where: { user_id: user.id },
            order: [['created_at', 'ASC']],
        });

        for (const membership of memberships) {
            const org = await Organization.findByPk(membership.organization_id);
            if (org && org.type === 'human') {
                if (user.default_organization_id !== org.id) {
                    user.default_organization_id = org.id;
                    await user.save();
                }
                return;
            }
        }

        const domain = user.email.split('@')[1]?.toLowerCase();
        if (!domain) {
            return;
        }

        const isPublicDomain = PUBLIC_EMAIL_DOMAINS.has(domain);

        if (!isPublicDomain) {
            const orgDomain = await OrgDomain.findOne({ where: { domain } });
            if (orgDomain) {
                const org = await Organization.findByPk(orgDomain.organization_id);
                if (org && org.type === 'human') {
                    await OrganizationMember.findOrCreate({
                        where: { organization_id: org.id, user_id: user.id },
                        defaults: {
                            role: 'member',
                            created_by: user.id,
                            updated_by: user.id,
                        },
                    });
                    if (user.default_organization_id !== org.id) {
                        user.default_organization_id = org.id;
                        await user.save();
                    }
                    return;
                }
            }
        }

        const orgName = isPublicDomain
            ? `${user.name}'s Workspace`
            : domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
        const slugBase = isPublicDomain
            ? `personal-${user.id.slice(0, 8)}`
            : domain.split('.')[0].toLowerCase();

        let slug = slugBase;
        let suffix = 0;
        while (await Organization.findOne({ where: { slug } })) {
            suffix += 1;
            slug = `${slugBase}-${suffix}`;
        }

        const org = await Organization.create({
            name: orgName,
            slug,
            type: 'human',
            owner_id: user.id,
            settings: {},
            created_by: user.id,
            updated_by: user.id,
        });

        if (!isPublicDomain) {
            await OrgDomain.findOrCreate({
                where: { organization_id: org.id, domain },
                defaults: { auto_approve: true },
            });
        }

        await OrganizationMember.create({
            organization_id: org.id,
            user_id: user.id,
            role: 'owner',
            created_by: user.id,
            updated_by: user.id,
        });

        user.default_organization_id = org.id;
        await user.save();
    }

    me = async (req: Request, res: Response): Promise<void> => {
        try {
            const auth = await this.getAuthenticatedUser(req);
            if (!auth) {
                res.status(401).json({ message: 'Not authenticated' });
                return;
            }

            res.status(200).json({
                auth_type: auth.auth_type,
                user: this.serializeUser(auth.user)
            });
        } catch (e: any) {
            res.status(500).json({ message: e.message || 'Internal server error' });
        }
    }

    introspect = async (req: Request, res: Response): Promise<void> => {
        try {
            const auth = await this.getAuthenticatedUser(req);
            if (!auth) {
                res.status(401).json({ authenticated: false, message: 'Not authenticated' });
                return;
            }

            res.status(200).json({
                authenticated: true,
                auth_type: auth.auth_type,
                token_id: auth.token_id,
                user: this.serializeUser(auth.user)
            });
        } catch (e: any) {
            res.status(500).json({ message: e.message || 'Internal server error' });
        }
    }

    login = async (req: Request, res: Response): Promise<void> => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                res.status(400).json({ message: 'Email and password are required' });
                return;
            }

            const user = await this.userService.authenticate(email, password);

            if (!user) {
                res.status(401).json({ message: 'Invalid email or password' });
                return;
            }

            await this.ensureHumanWorkspace(user);

            // Regenerate session to prevent session fixation attacks
            req.session.regenerate(async (err) => {
                if (err) {
                    res.status(500).json({ message: 'Session error' });
                    return;
                }

                try {
                    const session = req.session as any;
                    session.userId = user.id;
                    session.userEmail = user.email;
                    session.userName = user.name;
                    session.userRole = user.role;
                    await this.sessions.track(user.id, req.sessionID);

                    const tokenResponse = await this.buildTokenResponse(user.id, req);

                    res.status(200).json({
                        auth_type: tokenResponse ? 'session+bearer' : 'session',
                        user: this.serializeUser(user),
                        ...(tokenResponse || {})
                    });
                } catch (tokenError: any) {
                    res.status(500).json({ message: tokenError.message || 'Internal server error' });
                }
            });
        } catch (e: any) {
            res.status(e.code || 500).json({ message: e.message || 'Internal server error' });
        }
    }

    logout = async (req: Request, res: Response): Promise<void> => {
        try {
            const auth = await this.getAuthenticatedUser(req);
            const session = req.session as any;

            if (auth?.auth_type === 'bearer' && auth.token_id) {
                await this.userService.revokeAccessToken(auth.user.id, auth.token_id);
            }

            if (session?.userId) {
                await this.sessions.untrack(session.userId, req.sessionID);
                req.session.destroy((err) => {
                    if (err) {
                        res.status(500).json({ message: 'Failed to logout' });
                    } else {
                        res.status(200).json({ message: 'Logged out successfully' });
                    }
                });
                return;
            }

            if (auth?.auth_type === 'bearer') {
                res.status(200).json({ message: 'Bearer token revoked successfully' });
                return;
            }

            res.status(200).json({ message: 'Nothing to logout' });
        } catch (e: any) {
            res.status(500).json({ message: e.message || 'Internal server error' });
        }
    }

    register = async (req: Request, res: Response): Promise<void> => {
        try {
            const { email, password, name } = req.body;

            const decision = checkRegistration(this.registration, typeof email === 'string' ? email : '');
            if (!decision.allowed) {
                res.status(403).json({ message: decision.message });
                return;
            }

            if (!email || !password || !name
                || typeof email !== 'string' || typeof password !== 'string' || typeof name !== 'string') {
                res.status(400).json({ message: 'Email, password, and name are required' });
                return;
            }

            const user = await this.userService.create(email, password, name);
            await this.ensureHumanWorkspace(user);

            // Regenerate session to prevent session fixation attacks
            req.session.regenerate(async (err) => {
                if (err) {
                    res.status(500).json({ message: 'Session error' });
                    return;
                }

                try {
                    const session = req.session as any;
                    session.userId = user.id;
                    session.userEmail = user.email;
                    session.userName = user.name;
                    session.userRole = user.role;
                    await this.sessions.track(user.id, req.sessionID);

                    const tokenResponse = await this.buildTokenResponse(user.id, req);

                    res.status(201).json({
                        auth_type: tokenResponse ? 'session+bearer' : 'session',
                        user: this.serializeUser(user),
                        ...(tokenResponse || {})
                    });
                } catch (tokenError: any) {
                    res.status(500).json({ message: tokenError.message || 'Internal server error' });
                }
            });
        } catch (e: any) {
            const code = e.code || 500;
            res.status(code).json({ message: e.message || 'Internal server error' });
        }
    }

    createAccessToken = async (req: Request, res: Response): Promise<void> => {
        try {
            const auth = await this.getAuthenticatedUser(req);
            if (!auth) {
                res.status(401).json({ message: 'Not authenticated' });
                return;
            }

            const tokenName = String(req.body?.token_name || req.headers['x-client-name'] || 'app-client').trim() || 'app-client';
            const expiresInDaysRaw = req.body?.expires_in_days;
            const expiresInDays =
                expiresInDaysRaw === null || expiresInDaysRaw === undefined || expiresInDaysRaw === ''
                    ? 30
                    : Number(expiresInDaysRaw);

            const { token, accessToken } = await this.userService.createAccessToken(
                auth.user.id,
                tokenName,
                Number.isFinite(expiresInDays) ? expiresInDays : 30,
            );

            res.status(201).json({
                access_token: token,
                token_type: 'Bearer',
                token_name: accessToken.name,
                expires_at: accessToken.expires_at ? accessToken.expires_at.toISOString() : null
            });
        } catch (e: any) {
            const code = e.code || 500;
            res.status(code).json({ message: e.message || 'Internal server error' });
        }
    }

    listAccessTokens = async (req: Request, res: Response): Promise<void> => {
        try {
            const auth = await this.getAuthenticatedUser(req);
            if (!auth) {
                res.status(401).json({ message: 'Not authenticated' });
                return;
            }

            const tokens = await this.userService.listAccessTokens(auth.user.id);
            res.status(200).json({ tokens });
        } catch (e: any) {
            res.status(500).json({ message: e.message || 'Internal server error' });
        }
    }

    revokeAccessToken = async (req: Request, res: Response): Promise<void> => {
        try {
            const auth = await this.getAuthenticatedUser(req);
            if (!auth) {
                res.status(401).json({ message: 'Not authenticated' });
                return;
            }

            const tokenId = String(req.params.id || '').trim();
            if (!tokenId) {
                res.status(400).json({ message: 'Token id is required' });
                return;
            }

            const revoked = await this.userService.revokeAccessToken(auth.user.id, tokenId);
            if (!revoked) {
                res.status(404).json({ message: 'Token not found' });
                return;
            }

            res.status(200).json({ message: 'Token revoked successfully' });
        } catch (e: any) {
            res.status(500).json({ message: e.message || 'Internal server error' });
        }
    }

    /**
     * The signed-in caller, or null after answering 401 (not signed in) or 403 (signed in, but `allowed` says no).
     * Admin is decided from the stored user record, not the session copy, so a demoted admin loses access at once.
     */
    private async requireCaller(
        req: Request,
        res: Response,
        allowed: (user: { id: string; email: string; role: string }) => boolean,
    ): Promise<{ id: string; email: string; role: string } | null> {
        const auth = await this.getAuthenticatedUser(req);
        if (!auth) {
            res.status(401).json({ message: 'Not authenticated' });
            return null;
        }
        if (!allowed(auth.user)) {
            res.status(403).json({ message: 'Forbidden' });
            return null;
        }
        return auth.user;
    }

    /** GET /users/by-email/:email - an admin, or the user looking up their own address. */
    lookupByEmail = async (req: Request, res: Response): Promise<void> => {
        try {
            const email = req.params.email as string;
            if (!email) {
                res.status(400).json({ message: 'Email parameter is required' });
                return;
            }
            // Checked before the lookup, so the answer never reveals whether someone else's address has an account.
            const caller = await this.requireCaller(req, res, (u) =>
                u.role === 'admin' || u.email.toLowerCase() === email.toLowerCase());
            if (!caller) return;

            const user = await this.userService.findByEmail(email);
            if (!user) {
                res.status(404).json({ message: 'User not found' });
                return;
            }
            res.status(200).json({ user });
        } catch (e: any) {
            res.status(500).json({ message: e.message || 'Internal server error' });
        }
    }

    /** GET /users - admins only. */
    listUsers = async (req: Request, res: Response): Promise<void> => {
        try {
            const caller = await this.requireCaller(req, res, (u) => u.role === 'admin');
            if (!caller) return;

            const result = await this.userService.findAll();
            res.status(200).json(result);
        } catch (e: any) {
            res.status(500).json({ message: e.message || 'Internal server error' });
        }
    }
}
