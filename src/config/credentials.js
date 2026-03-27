/** Normalize user input to a canonical branch key */
function resolveBranchKey(input) {
  const s = input.trim().toLowerCase();
  if (s === 'ideologist' || s === 'ideologis+' || s === 'ideo') return 'ideologist';
  if (s === 'maari ventura' || s === 'ventura') return 'maari_ventura';
  if (s === 'maari bsb' || s === 'bsb') return 'maari_bsb';
  if (s === 'burjo ngegas gombel' || s === 'burgas gombel') return 'burgas_gombel';
  if (s === 'burjo ngegas pleburan' || s === 'burgas pleburan') return 'burgas_pleburan';
  return null;
}

/** Human-readable branch name shown in ERP (branch field value) */
const BRANCH_DISPLAY = {
  ideologist:      'IDEOLOGIS+',
  maari_ventura:   'MAARI VENTURA',
  maari_bsb:       'MAARI BSB',
  burgas_gombel:   'BURJO NGEGAS GOMBEL',
  burgas_pleburan: 'BURJO NGEGAS PLEBURAN',
};

/** Credential category per branch */
const BRANCH_CRED_GROUP = {
  ideologist:      'imvb',
  maari_ventura:   'imvb',
  maari_bsb:       'imvb',
  burgas_gombel:   'burgas',
  burgas_pleburan: 'burgas',
};

/** Credential sets */
const CRED_SETS = {
  imvb: {
    username: process.env.IMVB_USERNAME || '',
    password: process.env.IMVB_PASSWORD || '',
  },
  burgas: {
    username: process.env.BURGAS_USERNAME || '',
    password: process.env.BURGAS_PASSWORD || '',
  },
};

/**
 * Resolve credentials for a given branch key.
 * Returns { username, password } or null if branch unknown.
 */
function getCredentialsForBranch(branchKey) {
  const group = BRANCH_CRED_GROUP[branchKey];
  if (!group) return null;
  return CRED_SETS[group];
}

/** List of valid branch input names for user-facing hint */
const BRANCH_LIST =
  '- IDEOLOGIS+ (IDEO)\n' +
  '- MAARI VENTURA (VENTURA)\n' +
  '- MAARI BSB (BSB)\n' +
  '- BURJO NGEGAS GOMBEL (BURGAS GOMBEL)\n' +
  '- BURJO NGEGAS PLEBURAN (BURGAS PLEBURAN)';

module.exports = {
  resolveBranchKey,
  BRANCH_DISPLAY,
  getCredentialsForBranch,
  BRANCH_LIST,
};
