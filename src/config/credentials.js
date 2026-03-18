/**
 * ESB ERP credentials loaded from environment variables.
 * Supports multiple branches with different credential sets.
 */

/** Normalize user input to a canonical branch key */
function resolveBranchKey(input) {
  const s = input.trim().toLowerCase();
  if (s === 'ideologist')                                    return 'ideologist';
  if (s === 'maari ventura')                                 return 'maari_ventura';
  if (s === 'maari bsb')                                     return 'maari_bsb';
  if (s === 'burgas gombel'   || s === 'burjo ngegas gombel')   return 'burgas_gombel';
  if (s === 'burgas pleburan' || s === 'burjo ngegas pleburan') return 'burgas_pleburan';
  return null;
}

/** Human-readable branch name shown in ERP (branch field value) */
const BRANCH_DISPLAY = {
  ideologist:      'IDEOLOGIS+',
  maari_ventura:   'MAARI VENTURA',
  maari_bsb:       'MAARI BSB',
  burgas_gombel:   'Burjo Ngegas Gombel',
  burgas_pleburan: 'Burjo Ngegas Pleburan',
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
  '- ideologist\n' +
  '- maari ventura\n' +
  '- maari bsb\n' +
  '- burgas gombel (atau: burjo ngegas gombel)\n' +
  '- burgas pleburan (atau: burjo ngegas pleburan)';

module.exports = {
  resolveBranchKey,
  BRANCH_DISPLAY,
  getCredentialsForBranch,
  BRANCH_LIST,
};
