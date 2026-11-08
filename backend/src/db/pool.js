const { Pool, types } = require('pg');
const { env } = require('../config/env');

// 20 = BIGINT (int8). Paise ki values 9e15 se bahut chhoti hain, isliye Number safe hai.
types.setTypeParser(20, (value) => Number(value));

const pool = new Pool({ connectionString: env.DATABASE_URL });

module.exports = { pool };