import 'reflect-metadata';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const {
  SequelizeService,
  User,
  Organization,
  OrganizationMember,
  AgentProfile,
  Agent,
  OrgDomain,
  ensureUserAdminSchema,
} = await import('@teamsuzie/shared-auth');
const { sharedAuthConfig } = await import('./config.js');
const { Contact } = await import('./models/contact.js');
const { ensureSeed } = await import('./services/seed.js');
const { printStartupError } = await import('./services/startup-errors.js');

type ModelWithAssociate = ConstructorParameters<typeof SequelizeService>[1][number];

const sequelizeService = new SequelizeService(
  sharedAuthConfig,
  [User, Organization, OrganizationMember, AgentProfile, Agent, OrgDomain, Contact] as ModelWithAssociate[],
);

try {
  await sequelizeService.getSequelize().authenticate();
  await sequelizeService.getSequelize().sync();
  // sync() never adds a column to an existing table; this adds the user columns shared-auth reads now.
  await ensureUserAdminSchema(sequelizeService.getSequelize());
} catch (err) {
  printStartupError(err);
  process.exit(1);
}

const summary = await ensureSeed();

console.log('[seed] done');
console.log(`  admin login: ${summary.adminEmail} / ${summary.adminPassword}`);
console.log(`  demo login:  ${summary.demoEmail} / ${summary.demoPassword}`);
if (!summary.created) {
  console.log('  (no changes — everything already existed)');
}
process.exit(0);
