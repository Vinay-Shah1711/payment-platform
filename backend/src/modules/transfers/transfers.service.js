const crypto = require('node:crypto');
const { withTransaction } = require('../../db/withTransaction');
const { pool } = require('../../db/pool');
const { AppError } = require('../../utils/errors');
const { assertTransition } = require('./stateMachine');

const SYSTEM_ACCOUNT_ID = 1;
const TRANSFER_COLUMNS =
  'id, from_account_id, to_account_id, amount, currency, state, created_at';

function hashRequest({ fromAccountId, toAccountId, amount }) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ fromAccountId, toAccountId, amount }))
    .digest('hex');
}

// Asli kaam: lock, checks, transfer, ledger, balance, state, audit
async function executeTransfer(client, { fromAccountId, toAccountId, amount }) {
  // 1. Dono accounts lock karo, hamesha id ke order mein
  const ids = [fromAccountId, toAccountId].sort((a, b) => a - b);
  const { rows: locked } = await client.query(
    `SELECT id, balance, currency, status, allow_negative
       FROM accounts
      WHERE id = ANY($1::bigint[])
      ORDER BY id
      FOR UPDATE`,
    [ids]
  );

  const from = locked.find((a) => a.id === fromAccountId);
  const to = locked.find((a) => a.id === toAccountId);
  if (!from || !to) {
    throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
  }

  // 2. Checks
  if (from.status !== 'ACTIVE' || to.status !== 'ACTIVE') {
    throw new AppError(422, 'ACCOUNT_NOT_ACTIVE', 'Account is not active');
  }
  if (from.currency !== to.currency) {
    throw new AppError(422, 'CURRENCY_MISMATCH', 'Currencies differ');
  }
  if (!from.allow_negative && from.balance < amount) {
    throw new AppError(422, 'INSUFFICIENT_FUNDS', 'Insufficient funds');
  }

  // 3. Transfer row (state DB default se CREATED hoti hai)
  const {
    rows: [created],
  } = await client.query(
    `INSERT INTO transfers (from_account_id, to_account_id, amount, currency)
     VALUES ($1, $2, $3, $4)
     RETURNING id, state`,
    [fromAccountId, toAccountId, amount, from.currency]
  );

  // 4. Double-entry: ek debit, ek credit
  await client.query(
    `INSERT INTO ledger_entries (transfer_id, account_id, direction, amount)
     VALUES ($1, $2, 'DEBIT', $3),
            ($1, $4, 'CREDIT', $3)`,
    [created.id, fromAccountId, amount, toAccountId]
  );

  // 5. Balance cache update (rows already locked hain)
  await client.query(`UPDATE accounts SET balance = balance - $2 WHERE id = $1`, [
    fromAccountId,
    amount,
  ]);
  await client.query(`UPDATE accounts SET balance = balance + $2 WHERE id = $1`, [
    toAccountId,
    amount,
  ]);

  // 6. State machine: CREATED -> COMPLETED
  assertTransition(created.state, 'COMPLETED');
  const {
    rows: [transfer],
  } = await client.query(
    `UPDATE transfers SET state = 'COMPLETED'
      WHERE id = $1 AND state = $2
      RETURNING ${TRANSFER_COLUMNS}`,
    [created.id, created.state]
  );

  // 7. Audit
  await client.query(
    `INSERT INTO audit_log (actor, action, entity_type, entity_id, details)
     VALUES ('api', 'TRANSFER_COMPLETED', 'transfer', $1, $2)`,
    [transfer.id, JSON.stringify({ fromAccountId, toAccountId, amount })]
  );

  return transfer;
}

// Returns { transfer, replayed }
async function createTransfer(input, { idempotencyKey } = {}) {
  const { fromAccountId, toAccountId } = input;

  if (fromAccountId === toAccountId) {
    throw new AppError(400, 'SAME_ACCOUNT', 'Sender and receiver must differ');
  }

  return withTransaction(async (client) => {
    if (idempotencyKey) {
      const requestHash = hashRequest(input);

      // Key insert transfer ke saath ek hi transaction mein hota hai.
      // Same key ki doosri request yahan wait karti hai jab tak pehli commit/rollback na ho.
      const { rows } = await client.query(
        `INSERT INTO idempotency_keys (key, request_hash)
         VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING
         RETURNING key`,
        [idempotencyKey, requestHash]
      );

      if (rows.length === 0) {
        // Key pehle se hai: replay ya galat use
        const {
          rows: [existing],
        } = await client.query(
          `SELECT request_hash, response_body FROM idempotency_keys WHERE key = $1`,
          [idempotencyKey]
        );
        if (existing.request_hash !== requestHash) {
          throw new AppError(
            422,
            'IDEMPOTENCY_KEY_REUSED',
            'This Idempotency-Key was already used with a different request'
          );
        }
        return { transfer: existing.response_body, replayed: true };
      }
    }

    const transfer = await executeTransfer(client, input);

    if (idempotencyKey) {
      await client.query(`UPDATE idempotency_keys SET response_body = $2 WHERE key = $1`, [
        idempotencyKey,
        JSON.stringify(transfer),
      ]);
    }

    return { transfer, replayed: false };
  });
}

// Virtual paisa: system account se user ko transfer
async function fundAccount(accountId, amount) {
  const { transfer } = await createTransfer({
    fromAccountId: SYSTEM_ACCOUNT_ID,
    toAccountId: accountId,
    amount,
  });
  return transfer;
}

async function getTransfer(id) {
  const { rows } = await pool.query(
    `SELECT ${TRANSFER_COLUMNS} FROM transfers WHERE id = $1`,
    [id]
  );
  if (!rows[0]) {
    throw new AppError(404, 'TRANSFER_NOT_FOUND', 'Transfer not found');
  }

  const { rows: entries } = await pool.query(
    `SELECT id, account_id, direction, amount
       FROM ledger_entries
      WHERE transfer_id = $1
      ORDER BY id`,
    [id]
  );
  return { ...rows[0], ledger_entries: entries };
}

module.exports = { SYSTEM_ACCOUNT_ID, createTransfer, fundAccount, getTransfer };