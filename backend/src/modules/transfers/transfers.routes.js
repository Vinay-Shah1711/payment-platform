const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../../utils/asyncHandler');
const { AppError } = require('../../utils/errors');
const { createTransfer, getTransfer, SYSTEM_ACCOUNT_ID } = require('./transfers.service');

const transfersRouter = Router();

const transferSchema = z.object({
  fromAccountId: z.number().int().positive(),
  toAccountId: z.number().int().positive(),
  amount: z.number().int().positive(), // paise
});

transfersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get('Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new AppError(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key header is required (max 255 characters)'
      );
    }

    const body = transferSchema.parse(req.body);
    if (body.fromAccountId === SYSTEM_ACCOUNT_ID) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot transfer from the system account');
    }

    const { transfer, replayed } = await createTransfer(body, { idempotencyKey });
    if (replayed) {
      res.set('Idempotent-Replayed', 'true');
    }
    res.status(replayed ? 200 : 201).json(transfer);
  })
);

transfersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await getTransfer(id));
  })
);

module.exports = { transfersRouter };