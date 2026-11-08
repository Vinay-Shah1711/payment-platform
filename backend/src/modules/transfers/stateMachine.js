const { AppError } = require('../../utils/errors');

const TRANSITIONS = {
  CREATED: ['COMPLETED', 'FAILED'],
  COMPLETED: ['REVERSED'],
  FAILED: [],
  REVERSED: [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'INVALID_STATE_TRANSITION', `Cannot move transfer from ${from} to ${to}`);
  }
}

module.exports = { TRANSITIONS, canTransition, assertTransition };