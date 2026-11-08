const { ZodError } = require('zod');
const { AppError } = require('../utils/errors');

// Express ko error handler pehchanne ke liye 4 parameters chahiye, isliye _next likha hai
function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', details: err.issues },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message },
    });
  }
  console.error(err);
  return res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong' },
  });
}

module.exports = { errorHandler };