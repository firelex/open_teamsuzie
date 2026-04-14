import path from 'path';
import { Sequelize } from 'sequelize-typescript';
import { Umzug, SequelizeStorage } from 'umzug';
import type { ModelCtor } from 'sequelize-typescript';
import type { SharedAuthConfig } from '../types.js';

type ModelWithAssociate = ModelCtor & {
    associate?: (models: unknown) => void;
};

export default class SequelizeService {

    private sequelize: Sequelize;
    private registeredModels: ModelWithAssociate[];
    private migrationsPath?: string;

    constructor(config: SharedAuthConfig, models: ModelWithAssociate[], migrationsPath?: string) {
        if (!config.postgres.uri) {
            throw new Error('Database URI is not set in the configuration.');
        }

        this.registeredModels = models;
        this.migrationsPath = migrationsPath;

        this.sequelize = new Sequelize(config.postgres.uri, {
            models: models,
            logging: config.postgres.logging ? console.log : false
        });

        this.createModelAssociations();
    }

    init = async (run_migrations = false) => {
        try {
            await this.sequelize.authenticate();
            console.log('[DB] Connection established successfully');

            if (run_migrations) {
                await this.migrations();
                console.log('[DB] Migrations completed successfully');
            }
        } catch (e: unknown) {
            if (e instanceof Error) {
                console.error('[DB] Unable to connect to the database:', e.message);
            }
        }
    }

    migrations = () => {
        if (!this.migrationsPath) {
            console.log('[DB] No migrations path configured, skipping migrations');
            return Promise.resolve([]);
        }

        const sequelize = this.sequelize;
        const umzug = new Umzug({
            migrations: {
                glob: ['*.up.{js,cjs}', { cwd: this.migrationsPath }]
            },
            context: sequelize.getQueryInterface(),
            storage: new SequelizeStorage({ sequelize }),
            logger: console,
        });

        return umzug.up();
    }

    createModelAssociations = () => {
        for (const model of this.registeredModels) {
            if (typeof model.associate === 'function') {
                model.associate(this.sequelize.models);
            }
        }
    }

    model = (name: string) => {
        return this.sequelize.models[name];
    }

    models = () => {
        return this.sequelize.models;
    }

    /**
     * Get the underlying Sequelize instance for raw queries
     */
    getSequelize = () => {
        return this.sequelize;
    }
}
