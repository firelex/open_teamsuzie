# @teamsuzie/records

Org-scoped structured business records with arbitrary JSON custom fields.
No domain vocabulary — host apps register their own record types at
runtime (e.g. `matter`, `asset`, `ticket`).

## Exports

- `RECORDS_MIGRATIONS` — pass to `openDb({ migrations })` from
  `@teamsuzie/db-sqlite`.
- `RecordsStore` — `new RecordsStore({ db, idFactory?, now? })`.

## Org scoping

Every read and write takes an `orgId` explicitly. The store does no
auth; the host supplies tenant context. Type keys are unique per org
(`UNIQUE (org_id, key)`).

## Usage

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import { RECORDS_MIGRATIONS, RecordsStore } from '@teamsuzie/records';

const db = openDb({ path: 'app.db', migrations: RECORDS_MIGRATIONS });
const records = new RecordsStore({ db });

const type = records.createRecordType({ orgId: 'org-1', key: 'asset', name: 'Asset' });
const r = records.createRecord({
  orgId: 'org-1',
  typeId: type.id,
  title: 'Pump 1',
  customFields: { serial: 'X-9', kw: 12.5 },
});

records.updateRecord(r.id, { customFields: { ...r.customFields, kw: 14 } });
records.listRecords({ orgId: 'org-1', typeId: type.id, search: 'pump' });
```
