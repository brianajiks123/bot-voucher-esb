const STATE_TTL_MS = 5 * 60 * 1000;
const userStates = new Map();

// onExpire callbacks per userId: Map<userId, () => void>
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

/**
 * Daftarkan callback yang dipanggil saat state userId expire.
 * Callback menerima state terakhir sebagai argumen.
 */
function onStateExpire(userId, callback) {
  expireCallbacks.set(userId, callback);
}

module.exports = { setState, getState, clearState, onStateExpire };
