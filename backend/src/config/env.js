require('dotenv').config();
const { z } = require('zod');

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
});

const env = schema.parse(process.env);

module.exports = { env };