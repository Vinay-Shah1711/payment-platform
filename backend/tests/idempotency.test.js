const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { pool } = require('../src/db/pool');
const { createAccount, getAccount } = require('../src/modules/accounts/accounts.service');
const { createTransfer, fundAccount } = require('../src/modules/transfers/transfers.service');

after(async () => {
  await pool.end();
});

test('same key twice: money moves once and the second call is a replay', async () => {
  const a = await createAccount('gina');
  const b = await createAccount('hari');
  await fundAccount(a.id, 1000);

  const key = randomUUID();
  const input = { fromAccountId: a.id, toAccountId: b.id, amount: 300 };

  const first = await createTransfer(input, { idempotencyKey: key });
  const second = await createTransfer(input, { idempotencyKey: key });

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.transfer.id, first.transfer.id);
  assert.equal((await getAccount(a.id)).balance, 700);
  assert.equal((await getAccount(b.id)).balance, 300);
});

test('20 parallel retries with the same key: exactly one transfer is created', async () => {
  const a = await createAccount('ira');
  const b = await createAccount('jay');
  await fundAccount(a.id, 1000);

  const key = randomUUID();
  const input = { fromAccountId: a.id, toAccountId: b.id, amount: 400 };

  const results = await Promise.all(
    Array.from({ length: 20 }, () => createTransfer(input, { idempotencyKey: key }))
  );

  assert.equal(new Set(results.map((r) => r.transfer.id)).size, 1);
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  assert.equal((await getAccount(a.id)).balance, 600);
  assert.equal((await getAccount(b.id)).balance, 400);
});

test('same key with a different amount is rejected', async () => {
  const a = await createAccount('kim');
  const b = await createAccount('lee');
  await fundAccount(a.id, 1000);

  const key = randomUUID();
  await createTransfer({ fromAccountId: a.id, toAccountId: b.id, amount: 100 }, { idempotencyKey: key });

  await assert.rejects(
    createTransfer({ fromAccountId: a.id, toAccountId: b.id, amount: 200 }, { idempotencyKey: key }),
    { code: 'IDEMPOTENCY_KEY_REUSED' }
  );
  assert.equal((await getAccount(a.id)).balance, 900);
});

test('database blocks an invalid state transition (COMPLETED -> CREATED)', async () => {
  const a = await createAccount('mona');
  const b = await createAccount('neel');
  await fundAccount(a.id, 500);

  const { transfer } = await createTransfer({
    fromAccountId: a.id,
    toAccountId: b.id,
    amount: 100,
  });

  await assert.rejects(
    pool.query(`UPDATE transfers SET state = 'CREATED' WHERE id = $1`, [transfer.id]),
    /invalid transfer state transition/
  );
});