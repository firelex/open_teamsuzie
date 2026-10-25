#!/usr/bin/env node
import { loadConfig, type AgentConfig } from './config.js';
import { startService } from './service.js';

const USAGE = `email-agent — a local queue that lets agents read, search and send your Gmail/Outlook mail

Usage: email-agent [--config <path>] <command>

The config path can also come from EMAIL_AGENT_CONFIG.

Commands:
  serve                         Start the service (MCP at /mcp, console at /console)
  status                        Each account's state and the health of each mail action
  login <account>               Open a Chrome window to sign in to the account
  canary <account>              Check every mail action now without sending anything
  relearn <account> <action>    Start relearning one mail action now (e.g. compose_send); follow it with status
  capture <account>             Save the account's page as it is now (tree, outline, screenshot) for diagnosis
  approvals                     Sends waiting for your approval
  approve <id>                  Approve and queue a send
  reject <id> [reason]          Reject a send
  alerts                        Recent alerts`;

function fail(message: string): never {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

function parseArgs(argv: string[]): { configPath: string; command: string; rest: string[] } {
    const args = [...argv];
    let configPath = process.env.EMAIL_AGENT_CONFIG;
    const flag = args.indexOf('--config');
    if (flag !== -1) {
        configPath = args[flag + 1];
        if (!configPath) fail('--config needs a path');
        args.splice(flag, 2);
    }
    const [command, ...rest] = args;
    if (!command || command === 'help' || command === '--help') {
        process.stdout.write(`${USAGE}\n`);
        process.exit(command ? 0 : 1);
    }
    if (!configPath) fail('No config: pass --config <path> or set EMAIL_AGENT_CONFIG');
    return { configPath, command, rest };
}

async function admin(config: AgentConfig, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const url = `http://${config.listen.host}:${config.listen.port}/admin${path}`;
    let res: Response;
    try {
        res = await fetch(url, {
            method,
            headers: { authorization: `Bearer ${config.admin_token}`, 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch (error) {
        fail(`Could not reach the email-agent at ${url}. Is \`email-agent serve\` running? (${(error as Error).message})`);
    }
    const data = (await res.json()) as unknown;
    if (!res.ok) fail(`${res.status}: ${JSON.stringify(data)}`);
    return data;
}

function need(rest: string[], count: number, usage: string): string[] {
    if (rest.length < count) fail(`Usage: email-agent ${usage}`);
    return rest;
}

async function main(): Promise<void> {
    const { configPath, command, rest } = parseArgs(process.argv.slice(2));
    const config = loadConfig(configPath);
    const print = (value: unknown): void => { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); };
    const enc = encodeURIComponent;

    switch (command) {
        case 'serve': {
            const log = (message: string) => process.stdout.write(`${new Date().toISOString()} ${message}\n`);
            const service = await startService(config, { log });
            const shutdown = async () => {
                log('stopping');
                await service.close();
                process.exit(0);
            };
            process.on('SIGINT', () => void shutdown());
            process.on('SIGTERM', () => void shutdown());
            return;
        }
        case 'status':
            return print(await admin(config, 'GET', '/status'));
        case 'login': {
            const [account] = need(rest, 1, 'login <account>');
            return print(await admin(config, 'POST', `/login/${enc(account!)}`));
        }
        case 'canary': {
            const [account] = need(rest, 1, 'canary <account>');
            return print(await admin(config, 'POST', `/canary/${enc(account!)}`));
        }
        case 'relearn': {
            const [account, action] = need(rest, 2, 'relearn <account> <action>');
            return print(await admin(config, 'POST', `/relearn/${enc(account!)}/${enc(action!)}`));
        }
        case 'capture': {
            const [account] = need(rest, 1, 'capture <account>');
            return print(await admin(config, 'POST', `/capture/${enc(account!)}`));
        }
        case 'approvals':
            return print(await admin(config, 'GET', '/approvals'));
        case 'approve': {
            const [id] = need(rest, 1, 'approve <id>');
            return print(await admin(config, 'POST', `/approvals/${enc(id!)}/approve`));
        }
        case 'reject': {
            const [id, ...reason] = need(rest, 1, 'reject <id> [reason]');
            return print(await admin(config, 'POST', `/approvals/${enc(id!)}/reject`, reason.length > 0 ? { reason: reason.join(' ') } : {}));
        }
        case 'alerts':
            return print(await admin(config, 'GET', '/alerts?after=0'));
        default:
            fail(`Unknown command "${command}".\n\n${USAGE}`);
    }
}

main().catch((error: unknown) => fail((error as Error).stack ?? String(error)));
