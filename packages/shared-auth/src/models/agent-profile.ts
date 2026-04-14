import { Table, Column, DataType, Model, PrimaryKey, Default } from 'sequelize-typescript';

@Table({
    tableName: 'agent_profile',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class AgentProfile extends Model {

    @PrimaryKey
    @Default(DataType.UUIDV4)
    @Column({
        type: DataType.UUID
    })
    declare id: string;

    @Column({
        type: DataType.STRING(100),
        allowNull: false
    })
    declare slug: string;

    @Column({
        type: DataType.STRING(100),
        allowNull: true
    })
    declare template_slug: string | null;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    declare name: string;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare description: string | null;

    @Column({
        type: DataType.STRING(50),
        allowNull: false,
        defaultValue: 'openclaw'
    })
    declare agent_type: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: true
    })
    declare email_domain: string | null;

    @Column({
        type: DataType.STRING(100),
        allowNull: true
    })
    declare email_prefix: string | null;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare identity_template: string | null;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare soul_template: string | null;

    @Column({
        type: DataType.JSONB,
        allowNull: false,
        defaultValue: {}
    })
    declare default_config: Record<string, unknown>;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare whatsapp_creds_encrypted: string | null;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare is_primary: boolean;

    @Column({
        type: DataType.BLOB,
        allowNull: true
    })
    declare image: Buffer | null;

    @Column({
        type: DataType.STRING(100),
        allowNull: true
    })
    declare image_content_type: string | null;
}
