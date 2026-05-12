/**
 * Marketplace Registration
 *
 * Registers an external agent with the mothership marketplace on startup.
 * Idempotent — safe to call on every boot.
 */

export interface RegistrationConfig {
    /** Mothership base URL (e.g. https://admin.teamsuzie.com). */
    platformUrl: string;
    /** Registration token for marketplace authentication. */
    registrationToken?: string;
}

export interface AgentManifest {
    /** Unique slug (e.g. "suzielaw"). */
    slug: string;
    /** Display name (e.g. "Suzie Law"). */
    name: string;
    /** Short description. */
    description?: string;
    /** Organization/company that provides this agent. */
    provider_name?: string;
    /** Public base URL where this agent is reachable. */
    base_url: string;
    /** Health endpoint path. Default: /api/health */
    health_endpoint?: string;
    /** Chat endpoint path. Default: /api/chat */
    chat_endpoint?: string;
    /** Webhook endpoint path. Default: /api/webhook/mothership */
    webhook_endpoint?: string;
    /** Capabilities manifest. */
    capabilities?: { tools?: string[]; features?: string[] };
    /** Semantic version. */
    version?: string;
    /** Extensible metadata. */
    metadata?: Record<string, unknown>;
}

/**
 * Register this agent with the mothership marketplace.
 * Call at startup when `platformUrl` is configured.
 * Idempotent: the mothership upserts by slug.
 */
export async function registerWithPlatform(
    config: RegistrationConfig,
    manifest: AgentManifest
): Promise<{ id: string; slug: string; status: string } | null> {
    const url = `${config.platformUrl.replace(/\/$/, '')}/api/marketplace/register`;

    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (config.registrationToken) {
            headers['X-Registration-Token'] = config.registrationToken;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(manifest),
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            console.error(`[platform-bridge] Registration failed (${response.status}): ${text}`);
            return null;
        }

        const data = await response.json() as { id: string; slug: string; status: string };
        console.log(`[platform-bridge] Registered with marketplace as "${manifest.slug}" (id: ${data.id})`);
        return data;
    } catch (err: any) {
        console.error(`[platform-bridge] Registration failed:`, err.message);
        return null;
    }
}
