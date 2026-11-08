const express = require('express');
const { accountsRouter } = require('./modules/accounts/accounts.routes');
const { transfersRouter } = require('./modules/transfers/transfers.routes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/accounts', accountsRouter);
app.use('/transfers', transfersRouter);

app.use(errorHandler);

module.exports = { app };