// Creates a Team Suzie user (registration is closed). The password is read from standard input so it stays out of
// the shell history: echo -n "$PASSWORD" | node scripts/create-user.mjs <email> "<name>" [admin]
import 'reflect-metadata';
import { SequelizeService, UserService, User, Organization, OrganizationMember, Agent, AgentProfile, UserAccessToken } from '@teamsuzie/shared-auth';
import config from '../dist/config/index.js';

const [email, name, role] = process.argv.slice(2);
if (!email || !name) {
    console.error('usage: node scripts/create-user.mjs <email> "<name>" [admin]  (password on stdin)');
    process.exit(2);
}
let password = '';
for await (const chunk of process.stdin) password += chunk;
password = password.trim();
if (password.length < 12) {
    console.error('password must be at least 12 characters');
    process.exit(2);
}

const service = new SequelizeService(config, [User, Organization, OrganizationMember, AgentProfile, Agent, UserAccessToken]);
await service.getSequelize().authenticate();
const user = await new UserService(config).create(email, password, name, role === 'admin' ? 'admin' : 'user');
console.log('created', user.id, user.email);
await service.getSequelize().close();
