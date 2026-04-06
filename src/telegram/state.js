const STATE_TTL_MS = 5 * 60 * 1000;
const userStates = new Map();

function setState(userId, mode, extra) {
  userStates.set(userId, { mode, expiresAt: Date.now() + STATE_TTL_MS, ...extra });
}

function getState(userId) {
  const state = userStates.get(userId);
  if (!state) return null;
  if (Date.now() > state.expiresAt) { userStates.delete(userId); return null; }
  return state;
}

function clearState(userId) {
  userStates.delete(userId);
}

module.exports = { setState, getState, clearState };
