import { Table, Column, DataType, Model } from 'sequelize-typescript';

export type ConfigValueType = 'string' | 'number' | 'boolean' | 'json' | 'secret';
export type ConfigCategory = 'infrastructure' | 'ai' | 'oauth' | 'platform' | 'service';
export type ConfigScope = 'global' | 'org' | 'agent';

export interface ValidationSchema {
    type?: string;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    enum?: string[];
    required?: boolean;
}

@Table({
    tableName: 'config_definition',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class ConfigDefinition extends Model {

    @Column({
        type: DataType.UUID,
        defaultValue: DataType.UUIDV4,
        primaryKey: true
    })
    declare id: string;

    @Column({
        type: DataType.STRING(100),
        allowNull: false,
        unique: true
    })
    declare key: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    declare display_name: string;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare description: string | null;

    @Column({
        type: DataType.STRING(50),
        allowNull: false
    })
    declare category: ConfigCategory;

    @Column({
        type: DataType.STRING(20),
        allowNull: false
    })
    declare value_type: ConfigValueType;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare default_value: string | null;

    @Column({
        type: DataType.JSONB,
        allowNull: true
    })
    declare validation_schema: ValidationSchema | null;

    @Column({
        type: DataType.ARRAY(DataType.STRING(50)),
        allowNull: false
    })
    declare allowed_scopes: ConfigScope[];

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare is_sensitive: boolean;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare requires_restart: boolean;
}
