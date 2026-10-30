/**
 * Create an account while registration is closed (AUTH_ALLOW_REGISTRATION is not 'true').
 *
 *   pnpm create-user <email> "<name>" [admin]
 *
 * Run it from apps/platform/auth on the machine that runs the auth service (it reads the same .env). The password is
 * asked for and not shown; give it to the person, who signs in with it.
 */
import 'reflect-metadata';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

const envPath = resolve(process.cwd(), '.env');
const loaded = dotenv.config({ path: envPath });
if (loaded.error) {
    console.error(`Cannot read the auth service's settings from ${envPath}: ${loaded.error.message}`);
    process.exit(1);
}

const { SequelizeService, UserService, User, Organization, OrganizationMember, OrgDomain, Agent, AgentProfile, UserAccessToken } =
    await import('@teamsuzie/shared-auth');
const { default: config } = await import('./config/index.js');

const [email, name, role] = process.argv.slice(2);
if (!email || !name || (role !== undefined && role !== 'admin')) {
    console.error('Usage: pnpm create-user <email> "<name>" [admin]');
    process.exit(1);
}

/** Read a line from the terminal without showing what is typed. */
async function hidden(question: string): Promise<string> {
    let muted = false;
    const output = new Writable({
        write(chunk, _encoding, done) {
            if (!muted) process.stdout.write(chunk);
            done();
        },
    });
    const rl = createInterface({ input: process.stdin, output, terminal: true });
    const answer = new Promise<string>((done) => rl.question(question, done));
    muted = true;
    const value = await answer;
    rl.close();
    process.stdout.write('\n');
    return value;
}

const password = await hidden(`Password for ${email}: `);
if (password.length < 12) {
    console.error('The password must be at least 12 characters.');
    process.exit(1);
}
if ((await hidden('Again: ')) !== password) {
    console.error('The two passwords differ.');
    process.exit(1);
}

const sharedAuthConfig = {
    node_env: config.node_env,
    redis: config.redis,
    postgres: config.postgres,
    cookie: config.cookie,
    csrf: config.csrf,
    default_user_id: config.default_user_id,
    allow_registration: false,
};
const database = new SequelizeService(
    sharedAuthConfig,
    [User, Organization, OrganizationMember, OrgDomain, AgentProfile, Agent, UserAccessToken] as never,
);
// Connect directly so a database that cannot be reached stops the command with its own error.
await database.getSequelize().authenticate();
let user;
try {
    user = await new UserService(sharedAuthConfig).create(email, password, name, role === 'admin' ? 'admin' : 'user');
} catch (e) {
    // The user service's own refusals (an email already taken) carry code 400: said plainly; anything else is raised.
    if ((e as { code?: number }).code !== 400) throw e;
    console.error(`Not created: ${(e as Error).message}.`);
    await database.getSequelize().close();
    process.exit(1);
}
console.log(`Created ${user.email} (${user.name}), id ${user.id}${role === 'admin' ? ', an admin' : ''}.`);
await database.getSequelize().close();
