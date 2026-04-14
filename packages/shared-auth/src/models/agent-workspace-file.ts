import { Table, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { BaseModel } from './base-model.js';
import { Agent } from './agent.js';
import { Organization } from './organization.js';

export type ContentType = 'markdown' | 'json' | 'yaml' | 'text';

@Table({
    tableName: 'agent_workspace_file',
    underscored: true
})
export class AgentWorkspaceFile extends BaseModel {

    @ForeignKey(() => Agent)
    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare agent_id: string | null;

    @ForeignKey(() => Organization)
    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare organization_id: string | null;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    declare file_path: string;

    @Column({
        type: DataType.TEXT,
        allowNull: false
    })
    declare content: string;

    @Column({
        type: DataType.STRING(50),
        allowNull: false,
        defaultValue: 'markdown'
    })
    declare content_type: ContentType;

    @BelongsTo(() => Agent)
    declare agent?: Agent;

    @BelongsTo(() => Organization)
    declare organization?: Organization;
}
