// Creates any table the auth models expect that is missing (users, organizations, ...). The migrations create
// singular names ('user') that the models don't use, so a fresh database needs this before the service starts.
// sync() without alter only adds missing tables, so it is safe to run on every start.
import 'reflect-metadata';
import { SequelizeService, User, Organization, OrganizationMember, Agent, AgentProfile, UserAccessToken } from '@teamsuzie/shared-auth';
import config from '../dist/config/index.js';

const service = new SequelizeService(config, [User, Organization, OrganizationMember, AgentProfile, Agent, UserAccessToken]);
await service.getSequelize().authenticate();
await service.getSequelize().sync();
console.log('[sync-tables] auth tables present');
await service.getSequelize().close();
