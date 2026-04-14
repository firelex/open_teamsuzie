import { Table, Column, DataType, ForeignKey, BelongsTo, Model, PrimaryKey, Default } from 'sequelize-typescript';
import { Organization } from './organization.js';

@Table({
    tableName: 'org_domain',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class OrgDomain extends Model {

    @PrimaryKey
    @Default(DataType.UUIDV4)
    @Column({
        type: DataType.UUID
    })
    declare id: string;

    @ForeignKey(() => Organization)
    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare organization_id: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: false,
        unique: true
    })
    declare domain: string;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare auto_approve: boolean;

    @BelongsTo(() => Organization)
    declare organization?: Organization;
}
