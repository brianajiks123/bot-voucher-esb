const STATE_TTL_MS = 5 * 60 * 1000;
const userStates = new Map();

const expireCallbacks = new Map();

function setState(userId, mode, extra, ttlMs) {
  const ttl = ttlMs || STATE_TTL_MS;
  userStates.set(userId, { mode, expiresAt: Date.now() + ttl, ...extra });
}

function getState(userId) {
  const state = userStates.get(userId);
  if (!state) return null;
  if (Date.now() > state.expiresAt) {
    const cb = expireCallbacks.get(userId);
    expireCallbacks.delete(userId);
    userStates.delete(userId);
    if (cb) cb(state);
    return null;
  }
  return state;
}

function clearState(userId) {
  expireCallbacks.delete(userId);
  userStates.delete(userId);
}

function onStateExpire(userId, callback) {
  expireCallbacks.set(userId, callback);
}

module.exports = { setState, getState, clearState, onStateExpire };
