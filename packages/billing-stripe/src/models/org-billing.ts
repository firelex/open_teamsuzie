import { Table, Column, DataType, ForeignKey, BelongsTo, Model, PrimaryKey, Default } from 'sequelize-typescript';
import { Organization } from '@teamsuzie/shared-auth';

export type BillingStatus = 'active' | 'suspended' | 'pending' | 'exempt';

@Table({
    tableName: 'org_billing',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
})
export class OrgBilling extends Model {

    @PrimaryKey
    @Default(DataType.UUIDV4)
    @Column({
        type: DataType.UUID,
    })
    declare id: string;

    @ForeignKey(() => Organization)
    @Column({
        type: DataType.UUID,
        allowNull: false,
        unique: true,
    })
    declare org_id: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: true,
        unique: true,
    })
    declare stripe_customer_id: string | null;

    @Column({
        type: DataType.STRING(255),
        allowNull: true,
    })
    declare stripe_payment_method_id: string | null;

    @Column({
        type: DataType.DECIMAL(12, 6),
        allowNull: false,
        defaultValue: 0,
    })
    declare credit_balance: number;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: true,
    })
    declare auto_recharge: boolean;

    @Column({
        type: DataType.STRING(20),
        allowNull: false,
        defaultValue: 'pending',
    })
    declare billing_status: BillingStatus;

    @BelongsTo(() => Organization)
    declare organization?: Organization;
}
