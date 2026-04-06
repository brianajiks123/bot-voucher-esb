const BRANCH_ALIASES = {
  ven:  'MAARI VENTURA',
  bsb:  'MAARI BSB',
  gom:  'Burjo Ngegas Gombel',
  plb:  'Burjo Ngegas Pleburan',
  ideo: 'IDEOLOGIS+',
};

const KNOWN_BRANCH_CODES = {
  'burjo ngegas gombel':   'GOM',
  'burjo ngegas pleburan': 'PLB',
  'ideologis+':            'IDEO',
  'maari ventura':         'VEN',
  'maari bsb':             'BSB',
};

const MONTH_MAP = {
  januari:0, februari:1, febuari:1, maret:2, april:3,
  mei:4, juni:5, juli:6, agustus:7,
  september:8, oktober:9, november:10, desember:11,
};

const MONTH_NAMES = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];

function getMonthNameFromNumber(num) {
  return MONTH_NAMES[parseInt(num) - 1] || 'Januari';
}

function resolveBranch(alias) {
  return BRANCH_ALIASES[alias.toLowerCase()] || alias;
}

function resolveCanUseBranch(input) {
  return input.split(',').map((s) => resolveBranch(s.trim())).join(' | ');
}

function generateBranchCode(branchName) {
  const lower = branchName.toLowerCase().trim();
  if (KNOWN_BRANCH_CODES[lower]) return KNOWN_BRANCH_CODES[lower];
  const words = branchName.trim().split(/\s+/);
  return words[words.length - 1].substring(0, 3).toUpperCase();
}

function parseEntry(input, allowPrefix = false) {
  const quotedMatches = [...input.matchAll(/"([^"]+)"/g)];
  const isCustomBranch = /^(\w+)\s+"([^"]+)"/.test(input);

  let voucherPrefix = 'VCR';
  let customBranch  = null;
  let notes         = null;

  let clean = input;
  for (const m of quotedMatches) clean = clean.replace(m[0], '');
  clean = clean.replace(/\s+/g, ' ').trim();

  if (isCustomBranch) {
    customBranch = quotedMatches[0][1];
    if (allowPrefix) {
      if (quotedMatches.length >= 3)      { voucherPrefix = quotedMatches[1][1]; notes = quotedMatches[quotedMatches.length - 1][1]; }
      else if (quotedMatches.length === 2) { notes = quotedMatches[1][1]; }
    } else {
      // ignore any extra quoted strings as prefix, treat last quoted as notes
      if (quotedMatches.length >= 2) { notes = quotedMatches[quotedMatches.length - 1][1]; }
    }
  } else {
    if (allowPrefix) {
      if (quotedMatches.length >= 2)      { voucherPrefix = quotedMatches[0][1]; notes = quotedMatches[quotedMatches.length - 1][1]; }
      else if (quotedMatches.length === 1) { notes = quotedMatches[0][1]; }
    } else {
      // ignore any quoted string that would be a prefix, only last quoted is notes
      if (quotedMatches.length >= 1) { notes = quotedMatches[quotedMatches.length - 1][1]; }
    }
  }

  const tokens = clean.split(/\s+/);

  if (isCustomBranch) {
    if (tokens.length < 9) return null;
    const [mode, voucherLength, startDay, startMonthNum, , endDay, endMonthNum, year, minSales, ...rest] = tokens;
    const vouchers = parseVoucherAmounts(rest);
    if (vouchers.length === 0) return null;

    const firstAlias = customBranch.split(',')[0].trim();
    const branchName = resolveBranch(firstAlias);
    return {
      mode, branchName, branchCode: generateBranchCode(branchName),
      voucherPrefix, voucherLength: parseInt(voucherLength),
      startDay: parseInt(startDay), startMonth: getMonthNameFromNumber(startMonthNum),
      endDay: parseInt(endDay), endMonth: getMonthNameFromNumber(endMonthNum),
      year: parseInt(year), minSales: parseFloat(minSales),
      vouchers, notes, canUseOnBranch: resolveCanUseBranch(customBranch),
    };
  } else {
    if (tokens.length < 11) return null;
    const [mode, branchAlias, voucherLength, startDay, startMonthNum, , endDay, endMonthNum, year, minSales, ...rest] = tokens;
    const vouchers = parseVoucherAmounts(rest);
    if (vouchers.length === 0) return null;

    const branchName = resolveBranch(branchAlias);
    return {
      mode, branchName, branchCode: generateBranchCode(branchName),
      voucherPrefix, voucherLength: parseInt(voucherLength),
      startDay: parseInt(startDay), startMonth: getMonthNameFromNumber(startMonthNum),
      endDay: parseInt(endDay), endMonth: getMonthNameFromNumber(endMonthNum),
      year: parseInt(year), minSales: parseFloat(minSales),
      vouchers, notes, canUseOnBranch: null,
    };
  }
}

function parseVoucherAmounts(tokens) {
  const vouchers = [];
  for (const t of tokens) {
    const m = t.match(/^(\d+(?:\.\d+)?)-(\d+)$/);
    if (m) vouchers.push({ amount: parseFloat(m[1].replace(/\./g, '')), quantity: parseInt(m[2]) });
  }
  return vouchers;
}

function parseGenerateInput(input, allowPrefix = false) {
  const entries = input.split('|').map((s) => s.trim()).filter(Boolean);
  const singleCommands  = [];
  const regularCommands = [];

  for (const entry of entries) {
    const parsed = parseEntry(entry, allowPrefix);
    if (!parsed) throw new Error(`Format tidak valid: "${entry}"`);
    if (parsed.mode === 'single') singleCommands.push(parsed);
    else regularCommands.push(parsed);
  }

  if (singleCommands.length === 0 && regularCommands.length === 0) {
    throw new Error('Tidak ada data yang berhasil di-parse.');
  }

  return { singleCommands, regularCommands };
}

module.exports = {
  parseGenerateInput,
  MONTH_MAP,
  MONTH_NAMES,
  resolveBranch,
};
