const { pool } = require('../../db/pool');
const { AppError } = require('../../utils/errors');

const COLUMNS = 'id, owner, currency, status, balance, created_at';

async function createAccount(owner) {
  const { rows } = await pool.query(
    `INSERT INTO accounts (owner) VALUES ($1) RETURNING ${COLUMNS}`,
    [owner]
  );
  return rows[0];
}

async function getAccount(id) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM accounts WHERE id = $1`, [id]);
  if (!rows[0]) {
    throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
  }
  return rows[0];
}

async function getLedger(accountId) {
  await getAccount(accountId); // 404 agar account nahi hai
  const { rows } = await pool.query(
    `SELECT id, transfer_id, direction, amount, created_at
       FROM ledger_entries
      WHERE account_id = $1
      ORDER BY id DESC
      LIMIT 100`,
    [accountId]
  );
  return rows;
}

module.exports = { createAccount, getAccount, getLedger };