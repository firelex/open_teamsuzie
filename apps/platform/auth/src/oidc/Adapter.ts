import type { Adapter, AdapterPayload } from 'oidc-provider';
import { QueryTypes, Sequelize } from 'sequelize';

/**
 * One Postgres table backs every oidc-provider model. The `type` column
 * discriminates AccessToken / RefreshToken / Session / Grant / Interaction.
 * `payload` is a JSON blob defined by oidc-provider's schema.
 */
export class SequelizeOidcAdapter implements Adapter {
  private table = 'oidc_models';

  constructor(
    public name: string,
    private sequelize: Sequelize,
  ) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
    await this.sequelize.query(
      `INSERT INTO ${this.table} (id, type, payload, grant_id, user_code, uid, expires_at, created_at, updated_at)
       VALUES (:id, :type, :payload, :grantId, :userCode, :uid, :expiresAt, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET payload = :payload, expires_at = :expiresAt, updated_at = NOW()`,
      {
        replacements: {
          id,
          type: this.name,
          payload: JSON.stringify(payload),
          grantId: (payload as { grantId?: string }).grantId ?? null,
          userCode: (payload as { userCode?: string }).userCode ?? null,
          uid: (payload as { uid?: string }).uid ?? null,
          expiresAt,
        },
        type: QueryTypes.INSERT,
      },
    );
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    const rows = await this.sequelize.query<{ payload: AdapterPayload; consumed_at: Date | null }>(
      `SELECT payload, consumed_at FROM ${this.table} WHERE id = :id AND type = :type`,
      { replacements: { id, type: this.name }, type: QueryTypes.SELECT },
    );
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return { ...row.payload, ...(row.consumed_at ? { consumed: row.consumed_at } : {}) };
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    const rows = await this.sequelize.query<{ payload: AdapterPayload }>(
      `SELECT payload FROM ${this.table} WHERE user_code = :userCode AND type = :type`,
      { replacements: { userCode, type: this.name }, type: QueryTypes.SELECT },
    );
    return rows[0]?.payload;
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    const rows = await this.sequelize.query<{ payload: AdapterPayload }>(
      `SELECT payload FROM ${this.table} WHERE uid = :uid AND type = :type`,
      { replacements: { uid, type: this.name }, type: QueryTypes.SELECT },
    );
    return rows[0]?.payload;
  }

  async destroy(id: string): Promise<void> {
    await this.sequelize.query(
      `DELETE FROM ${this.table} WHERE id = :id AND type = :type`,
      { replacements: { id, type: this.name }, type: QueryTypes.DELETE },
    );
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.sequelize.query(
      `DELETE FROM ${this.table} WHERE grant_id = :grantId`,
      { replacements: { grantId }, type: QueryTypes.DELETE },
    );
  }

  async consume(id: string): Promise<void> {
    await this.sequelize.query(
      `UPDATE ${this.table} SET consumed_at = NOW() WHERE id = :id AND type = :type`,
      { replacements: { id, type: this.name }, type: QueryTypes.UPDATE },
    );
  }
}
