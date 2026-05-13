import { Table, Column, DataType, ForeignKey, Model, PrimaryKey, Default } from 'sequelize-typescript';
import { Organization } from '@teamsuzie/shared-auth';

export type BillingTransactionType = 'topup' | 'deduction' | 'refund' | 'adjustment' | 'initial';

@Table({
    tableName: 'billing_transaction',
    underscored: true,
    timestamps: false,
})
export class BillingTransaction extends Model {

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
    })
    declare org_id: string;

    @Column({
        type: DataType.STRING(30),
        allowNull: false,
    })
    declare type: BillingTransactionType;

    @Column({
        type: DataType.DECIMAL(12, 6),
        allowNull: false,
    })
    declare amount: number;

    @Column({
        type: DataType.DECIMAL(12, 6),
        allowNull: false,
    })
    declare balance_after: number;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
    })
    declare description: string | null;

    @Column({
        type: DataType.STRING(255),
        allowNull: true,
        // Idempotency key: Stripe may redeliver `payment_intent.succeeded`
        // for the same intent (network blips, manual replays from the
        // dashboard). Unique on the column makes a duplicate INSERT throw
        // and the webhook code does a SELECT-first check inside the
        // transaction. Postgres treats multiple NULLs as distinct, so
        // rows with no payment-intent id (deductions, adjustments) still
        // coexist freely.
        unique: true,
    })
    declare stripe_payment_intent_id: string | null;

    @Column({
        type: DataType.STRING(255),
        allowNull: true,
        // Same idempotency rationale as stripe_payment_intent_id above —
        // pairs with the `checkout.session.completed` retry case.
        unique: true,
    })
    declare stripe_checkout_session_id: string | null;

    @Column({
        type: DataType.JSONB,
        allowNull: true,
    })
    declare metadata: Record<string, unknown> | null;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
    })
    declare created_at: Date;
}
