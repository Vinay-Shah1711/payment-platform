const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../src/db/pool');
const { createAccount, getAccount } = require('../src/modules/accounts/accounts.service');
const { createTransfer, fundAccount } = require('../src/modules/transfers/transfers.service');

after(async () => {
  await pool.end();
});

// Invariant 1: poori ledger mein total debit = total credit
async function assertLedgerBalanced() {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0)  AS debits,
      COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0) AS credits
    FROM ledger_entries`);
  assert.equal(Number(rows[0].debits), Number(rows[0].credits), 'debits must equal credits');
}

// Invariant 2: har account ka balance = uski ledger entries ka net sum
async function assertBalancesMatchLedger() {
  const { rows } = await pool.query(`
    SELECT a.id
      FROM accounts a
      LEFT JOIN (
        SELECT account_id,
               SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END) AS net
          FROM ledger_entries GROUP BY account_id
      ) l ON l.account_id = a.id
     WHERE a.balance <> COALESCE(l.net, 0)`);
  assert.equal(rows.length, 0, 'every account balance must match its ledger');
}

test('transfer moves money and keeps the ledger balanced', async () => {
  const a = await createAccount('alice');
  const b = await createAccount('bob');
  await fundAccount(a.id, 5000);

  await createTransfer({ fromAccountId: a.id, toAccountId: b.id, amount: 1200 });

  assert.equal((await getAccount(a.id)).balance, 3800);
  assert.equal((await getAccount(b.id)).balance, 1200);
  await assertLedgerBalanced();
  await assertBalancesMatchLedger();
});

test('insufficient funds is rejected and nothing changes', async () => {
  const a = await createAccount('carol');
  const b = await createAccount('dave');
  await fundAccount(a.id, 100);

  await assert.rejects(
    createTransfer({ fromAccountId: a.id, toAccountId: b.id, amount: 500 }),
    { code: 'INSUFFICIENT_FUNDS' }
  );

  assert.equal((await getAccount(a.id)).balance, 100);
  assert.equal((await getAccount(b.id)).balance, 0);
  await assertLedgerBalanced();
});

test('50 concurrent transfers with funds for only 10: exactly 10 succeed', async () => {
  const a = await createAccount('erin');
  const b = await createAccount('frank');
  await fundAccount(a.id, 1000);

  const results = await Promise.allSettled(
    Array.from({ length: 50 }, () =>
      createTransfer({ fromAccountId: a.id, toAccountId: b.id, amount: 100 })
    )
  );

  const ok = results.filter((r) => r.status === 'fulfilled').length;
  assert.equal(ok, 10);
  assert.equal((await getAccount(a.id)).balance, 0);
  assert.equal((await getAccount(b.id)).balance, 1000);
  await assertLedgerBalanced();
  await assertBalancesMatchLedger();
});

test('ledger entries cannot be updated or deleted', async () => {
  await assert.rejects(pool.query(`UPDATE ledger_entries SET amount = 1`), /immutable/);
  await assert.rejects(pool.query(`DELETE FROM ledger_entries`), /immutable/);
});