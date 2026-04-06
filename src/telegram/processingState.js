let isProcessing = false;
let currentProcess = null;

function acquireLock(label) {
  if (isProcessing) return false;
  isProcessing = true;
  currentProcess = label;
  return true;
}

function releaseLock() {
  isProcessing = false;
  currentProcess = null;
}

function getLockState() {
  return { isProcessing, currentProcess };
}

module.exports = { acquireLock, releaseLock, getLockState };
