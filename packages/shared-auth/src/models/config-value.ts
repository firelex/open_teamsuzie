import { Table, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { BaseModel } from './base-model.js';
import { ConfigDefinition } from './config-definition.js';

export type Scope = 'global' | 'org' | 'user' | 'agent';

@Table({
    tableName: 'config_value',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class ConfigValue extends BaseModel {

    @ForeignKey(() => ConfigDefinition)
    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare definition_id: string;

    @Column({
        type: DataType.STRING(20),
        allowNull: false
    })
    declare scope: Scope;

    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare scope_id: string | null;

    @Column({
        type: DataType.TEXT,
        allowNull: false
    })
    declare value_encrypted: string;

    @BelongsTo(() => ConfigDefinition)
    declare definition?: ConfigDefinition;
}
