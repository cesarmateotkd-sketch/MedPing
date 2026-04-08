'use strict';

/**
 * Wraps an async Express route handler so that rejected promises are forwarded
 * to next() rather than causing an unhandled rejection.
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
