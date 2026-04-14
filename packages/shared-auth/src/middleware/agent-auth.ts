import type { Request, Response, NextFunction } from 'express';
import { Agent } from '../models/agent.js';
import { User } from '../models/user.js';
import { Organization } from '../models/organization.js';
import { OrganizationMember } from '../models/organization-member.js';
import { verifyApiKey } from '../utils/encryption.js';

export interface AgentContext {
    agent_id: string;
    agent_name: string;
    user_id: string;
    org_id: string | null;
    organization_id: string;
    scopes: string[];
    scope_hierarchy: ScopeRef[];
}

export interface ScopeRef {
    scope: 'global' | 'org' | 'agent';
    scope_id: string | null;
}

declare global {
    namespace Express {
        interface Request {
            agentContext?: AgentContext;
        }
    }
}

export interface AgentAuthConfig {
    headerName?: string;
    allowedScopes?: string[];
    requireScopes?: string[];
}

const DEFAULT_CONFIG: AgentAuthConfig = {
    headerName: 'X-Agent-API-Key',
    allowedScopes: [],
    requireScopes: []
};

export default class AgentAuthMiddleware {
    private config: AgentAuthConfig;

    constructor(config?: AgentAuthConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    authenticate = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        const apiKey = req.headers[this.config.headerName!.toLowerCase()] as string ||
                       req.headers['authorization']?.replace('Bearer ', '');

        if (!apiKey) {
            res.status(401).json({
                error: 'Unauthorized',
                message: 'API key required. Set X-Agent-API-Key header or Authorization: Bearer <key>'
            });
            return;
        }

        if (!apiKey.startsWith('dtk_')) {
            res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid API key format'
            });
            return;
        }

        try {
            const keyPrefix = apiKey.substring(0, 12);

            const agent = await Agent.findOne({
                where: {
                    api_key_prefix: keyPrefix,
                    status: 'active'
                },
                include: [{
                    model: User,
                    as: 'user',
                    required: true
                }]
            });

            if (!agent || !agent.api_key_hash) {
                res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Invalid API key'
                });
                return;
            }

            if (!verifyApiKey(apiKey, agent.api_key_hash)) {
                res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Invalid API key'
                });
                return;
            }

            const user = agent.user!;

            // Resolve org: prefer agent.organization_id (new model), fall back to user membership (backward compat)
            let orgId: string | null = (agent as any).organization_id ?? null;

            if (!orgId) {
                orgId = user.default_organization_id ?? null;
            }

            if (!orgId) {
                const membership = await OrganizationMember.findOne({
                    where: { user_id: user.id },
                    order: [['created_at', 'ASC']]
                });
                if (membership) {
                    orgId = membership.organization_id;
                }
            }

            const scopeHierarchy: ScopeRef[] = [
                { scope: 'agent', scope_id: agent.id }
            ];

            if (orgId) {
                scopeHierarchy.push({ scope: 'org', scope_id: orgId });
            }

            scopeHierarchy.push({ scope: 'global', scope_id: null });

            const agentScopes = (agent.config as any)?.scopes || [];

            if (this.config.requireScopes && this.config.requireScopes.length > 0) {
                const hasRequiredScopes = this.config.requireScopes.every(
                    scope => agentScopes.includes(scope)
                );
                if (!hasRequiredScopes) {
                    res.status(403).json({
                        error: 'Forbidden',
                        message: 'Insufficient permissions'
                    });
                    return;
                }
            }

            req.agentContext = {
                agent_id: agent.id,
                agent_name: agent.name,
                user_id: user.id,
                org_id: orgId,
                organization_id: orgId ?? '',
                scopes: agentScopes,
                scope_hierarchy: scopeHierarchy
            };

            next();
        } catch (error) {
            console.error('[AGENT_AUTH] Error:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Authentication failed'
            });
        }
    };

    requireScope(scope: string) {
        return (req: Request, res: Response, next: NextFunction): void => {
            if (!req.agentContext) {
                res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Agent authentication required'
                });
                return;
            }

            if (!req.agentContext.scopes.includes(scope)) {
                res.status(403).json({
                    error: 'Forbidden',
                    message: `Missing required scope: ${scope}`
                });
                return;
            }

            next();
        };
    }
}
