import type { Request, Response } from 'express';
import { Organization } from '../models/organization.js';
import { OrganizationMember } from '../models/organization-member.js';
import { OrgDomain } from '../models/org-domain.js';
import { User } from '../models/user.js';
import UserService from '../services/user.js';
import type { SharedAuthConfig } from '../types.js';

const PUBLIC_EMAIL_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
    'yahoo.com', 'yahoo.co.uk', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
    'protonmail.com', 'proton.me', 'mail.com', 'zoho.com', 'yandex.com',
    'gmx.com', 'gmx.net', 'fastmail.com',
]);

export default class AuthController {

    private userService: UserService;

    constructor(config: SharedAuthConfig) {
        this.userService = new UserService(config);
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
            const session = req.session as any;
            if (session.userId) {
                let role = session.userRole;
                if (!role) {
                    const user = await this.userService.findById(session.userId);
                    if (user) {
                        role = user.role;
                        session.userRole = role;
                    } else {
                        role = 'user';
                    }
                }

                res.status(200).json({
                    user: {
                        id: session.userId,
                        email: session.userEmail,
                        name: session.userName,
                        role: role
                    }
                });
            } else {
                res.status(401).json({ message: 'Not authenticated' });
            }
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
            req.session.regenerate((err) => {
                if (err) {
                    res.status(500).json({ message: 'Session error' });
                    return;
                }

                const session = req.session as any;
                session.userId = user.id;
                session.userEmail = user.email;
                session.userName = user.name;
                session.userRole = user.role;

                res.status(200).json({
                    user: {
                        id: user.id,
                        email: user.email,
                        name: user.name,
                        role: user.role
                    }
                });
            });
        } catch (e: any) {
            res.status(500).json({ message: e.message || 'Internal server error' });
        }
    }

    logout = async (req: Request, res: Response): Promise<void> => {
        try {
            req.session.destroy((err) => {
                if (err) {
                    res.status(500).json({ message: 'Failed to logout' });
                } else {
                    res.status(200).json({ message: 'Logged out successfully' });
                }
            });
        } catch (e: any) {
            res.status(500).json({ message: e.message || 'Internal server error' });
        }
    }

    register = async (req: Request, res: Response): Promise<void> => {
        try {
            const { email, password, name } = req.body;

            if (!email || !password || !name) {
                res.status(400).json({ message: 'Email, password, and name are required' });
                return;
            }

            const user = await this.userService.create(email, password, name);

            // Regenerate session to prevent session fixation attacks
            req.session.regenerate((err) => {
                if (err) {
                    res.status(500).json({ message: 'Session error' });
                    return;
                }

                const session = req.session as any;
                session.userId = user.id;
                session.userEmail = user.email;
                session.userName = user.name;
                session.userRole = user.role;

                res.status(201).json({
                    user: {
                        id: user.id,
                        email: user.email,
                        name: user.name,
                        role: user.role
                    }
                });
            });
        } catch (e: any) {
            const code = e.code || 500;
            res.status(code).json({ message: e.message || 'Internal server error' });
        }
    }

    lookupByEmail = async (req: Request, res: Response): Promise<void> => {
        try {
            const email = req.params.email as string;
            if (!email) {
                res.status(400).json({ message: 'Email parameter is required' });
                return;
            }
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

    listUsers = async (_req: Request, res: Response): Promise<void> => {
        try {
            const result = await this.userService.findAll();
            res.status(200).json(result);
        } catch (e: any) {
            res.status(500).json({ message: e.message || 'Internal server error' });
        }
    }
}
