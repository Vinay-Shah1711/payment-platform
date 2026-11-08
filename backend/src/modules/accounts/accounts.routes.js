const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../../utils/asyncHandler');
const { fundAccount } = require('../transfers/transfers.service');
const { createAccount, getAccount, getLedger } = require('./accounts.service');

const accountsRouter = Router();

const idSchema = z.coerce.number().int().positive();

accountsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { owner } = z.object({ owner: z.string().min(1) }).parse(req.body);
    res.status(201).json(await createAccount(owner));
  })
);

accountsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getAccount(idSchema.parse(req.params.id)));
  })
);

accountsRouter.get(
  '/:id/ledger',
  asyncHandler(async (req, res) => {
    res.json(await getLedger(idSchema.parse(req.params.id)));
  })
);

// Virtual paisa daalne ke liye (sirf development ke liye)
accountsRouter.post(
  '/:id/fund',
  asyncHandler(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { amount } = z.object({ amount: z.number().int().positive() }).parse(req.body);
    res.status(201).json(await fundAccount(id, amount));
  })
);

module.exports = { accountsRouter };