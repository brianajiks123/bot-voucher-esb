const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// ─── Constants ────────────────────────────────────────────────────────────────

const BRANCH_ALIASES = {
  ven:  'MAARI VENTURA',
  bsb:  'MAARI BSB',
  gom:  'Burjo Ngegas Gombel',
  plb:  'Burjo Ngegas Pleburan',
  ideo: 'IDEOLOGIS+',
};

const KNOWN_BRANCH_CODES = {
  'burjo ngegas gombel':    'GOM',
  'burjo ngegas pleburan': 'PLB',
  'ideologis+':             'IDEO',
  'maari ventura':          'VEN',
  'maari bsb':              'BSB',
};

const MONTH_NAMES = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];

const MONTH_MAP = {
  januari:0, februari:1, febuari:1, maret:2, april:3,
  mei:4, juni:5, juli:6, agustus:7,
  september:8, oktober:9, november:10, desember:11,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomLetters(n) {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let r = '';
  for (let i = 0; i < n; i++) r += L[Math.floor(Math.random() * L.length)];
  return r;
}

function randomNumbers(n) {
  let r = '';
  for (let i = 0; i < n; i++) r += Math.floor(Math.random() * 10);
  return r;
}

function getMonthNumber(month) { return MONTH_MAP[month.toLowerCase()] ?? 0; }
function getMonthName(idx)     { return MONTH_NAMES[idx]; }
function getMonthNameFromNumber(num) { return MONTH_NAMES[parseInt(num) - 1] || 'Januari'; }

function formatDate(day, month, year) {
  const dd = String(day).padStart(2, '0');
  const mm = String(getMonthNumber(month) + 1).padStart(2, '0');
  return `${dd}/${mm}/${year}`;
}

function generateBranchCode(branchName) {
  const lower = branchName.toLowerCase().trim();
  if (KNOWN_BRANCH_CODES[lower]) return KNOWN_BRANCH_CODES[lower];
  const words = branchName.trim().split(/\s+/);
  return words[words.length - 1].substring(0, 3).toUpperCase();
}

function resolveBranch(alias) {
  return BRANCH_ALIASES[alias.toLowerCase()] || alias;
}

function resolveCanUseBranch(input) {
  return input
    .split(',')
    .map(s => resolveBranch(s.trim()))
    .join(' | ');
}

function generateDateRange(startDay, startMonth, endDay, endMonth, year) {
  const dates = [];
  const start = new Date(year, getMonthNumber(startMonth), startDay);
  const end   = new Date(year, getMonthNumber(endMonth),   endDay);
  let cur = new Date(start);
  while (cur <= end) {
    const monthName = getMonthName(cur.getMonth());
    dates.push({
      day: cur.getDate(), month: monthName, year,
      monthCode:     cur.getDate() + monthName.charAt(0).toUpperCase(),
      folderName:    `${cur.getDate()} ${monthName} ${year}`,
      dateFormatted: formatDate(cur.getDate(), monthName, year),
    });
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ─── Parse Input ──────────────────────────────────────────────────────────────

function parseEntry(input) {
  const quotedMatches = [...input.matchAll(/"([^"]+)"/g)];

  const customBranchPattern = /^(\w+)\s+"([^"]+)"/;
  const customBranchMatch   = input.match(customBranchPattern);
  const isCustomBranch      = customBranchMatch !== null;

  let voucherPrefix = 'VCR';
  let customBranch  = null;
  let notes         = null;

  let clean = input;
  for (const m of quotedMatches) clean = clean.replace(m[0], '');
  clean = clean.replace(/\s+/g, ' ').trim();

  if (isCustomBranch) {
    customBranch = quotedMatches[0][1];
    if (quotedMatches.length >= 3) {
      voucherPrefix = quotedMatches[1][1];
      notes = quotedMatches[quotedMatches.length - 1][1];
    } else if (quotedMatches.length === 2) {
      notes = quotedMatches[1][1];
    }
  } else {
    if (quotedMatches.length >= 2) {
      voucherPrefix = quotedMatches[0][1];
      notes = quotedMatches[quotedMatches.length - 1][1];
    } else if (quotedMatches.length === 1) {
      notes = quotedMatches[0][1];
    }
  }

  const tokens = clean.split(/\s+/);

  if (isCustomBranch) {
    if (tokens.length < 10) return null;
    const mode          = tokens[0].toLowerCase();
    const voucherLength = parseInt(tokens[1]);
    const startDay      = parseInt(tokens[2]);
    const startMonth    = getMonthNameFromNumber(tokens[3]);
    const endDay        = parseInt(tokens[5]);
    const endMonth      = getMonthNameFromNumber(tokens[6]);
    const year          = parseInt(tokens[7]);
    const minSales      = parseFloat(tokens[8]);

    const vouchers = [];
    for (let i = 9; i < tokens.length; i++) {
      const m = tokens[i].match(/^(\d+(?:\.\d+)?)-(\d+)$/);
      if (m) vouchers.push({ amount: parseFloat(m[1].replace(/\./g, '')), quantity: parseInt(m[2]) });
    }
    if (vouchers.length === 0) return null;

    const firstAlias = customBranch.split(',')[0].trim();
    const branchName = resolveBranch(firstAlias);

    return {
      mode, branchName, branchCode: generateBranchCode(branchName),
      voucherPrefix, voucherLength,
      startDay, startMonth, endDay, endMonth, year,
      minSales, vouchers, notes,
      canUseOnBranch: resolveCanUseBranch(customBranch),
    };
  } else {
    if (tokens.length < 11) return null;
    const mode          = tokens[0].toLowerCase();
    const branchAlias   = tokens[1];
    const voucherLength = parseInt(tokens[2]);
    const startDay      = parseInt(tokens[3]);
    const startMonth    = getMonthNameFromNumber(tokens[4]);
    const endDay        = parseInt(tokens[6]);
    const endMonth      = getMonthNameFromNumber(tokens[7]);
    const year          = parseInt(tokens[8]);
    const minSales      = parseFloat(tokens[9]);

    const vouchers = [];
    for (let i = 10; i < tokens.length; i++) {
      const m = tokens[i].match(/^(\d+(?:\.\d+)?)-(\d+)$/);
      if (m) vouchers.push({ amount: parseFloat(m[1].replace(/\./g, '')), quantity: parseInt(m[2]) });
    }
    if (vouchers.length === 0) return null;

    const branchName = resolveBranch(branchAlias);
    return {
      mode, branchName, branchCode: generateBranchCode(branchName),
      voucherPrefix, voucherLength,
      startDay, startMonth, endDay, endMonth, year,
      minSales, vouchers, notes,
      canUseOnBranch: null,
    };
  }
}

function parseGenerateInput(input) {
  const entries = input.split('|').map(s => s.trim()).filter(Boolean);
  const singleCommands  = [];
  const regularCommands = [];

  for (const entry of entries) {
    const parsed = parseEntry(entry);
    if (!parsed) throw new Error(`Format tidak valid: "${entry}"`);
    if (parsed.mode === 'single') singleCommands.push(parsed);
    else regularCommands.push(parsed);
  }

  if (singleCommands.length === 0 && regularCommands.length === 0) {
    throw new Error('Tidak ada data yang berhasil di-parse.');
  }

  return { singleCommands, regularCommands };
}

// ─── Excel Generators ─────────────────────────────────────────────────────────

const VOUCHER_COLUMNS = [
  { header: 'No',                   key: 'no',               width: 5  },
  { header: 'Voucher Type',         key: 'voucherType',      width: 15 },
  { header: 'Voucher Code',         key: 'voucherCode',      width: 25 },
  { header: 'Branch Name',          key: 'branchName',       width: 25 },
  { header: 'Voucher Length',       key: 'voucherLength',    width: 15 },
  { header: 'Minimum Sales Amount', key: 'minimumSales',     width: 20 },
  { header: 'Voucher Amount',       key: 'voucherAmount',    width: 15 },
  { header: 'Voucher Sales Price',  key: 'voucherSalesPrice',width: 20 },
  { header: 'Notes',                key: 'notes',            width: 30 },
  { header: 'Can Use on Branch (s)',key: 'canUseOnBranch',   width: 30 },
];

async function writeVoucherWorkbook(rows, filePath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Vouchers');
  ws.columns = VOUCHER_COLUMNS;
  rows.forEach(r => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
  await wb.xlsx.writeFile(filePath);
}

async function writeActivatorWorkbook(voucherCodes, startDate, endDate, additionalInfo, filePath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Activator');
  ws.addRow([]); ws.addRow([]); ws.addRow([]);
  const hdr = ws.addRow(['#','Voucher Code','Branch Name','Voucher Amount','Start Date','End Date','Additional Information']);
  hdr.font = { bold: true };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
  ws.columns = [
    { key:'no',width:5 },{ key:'voucherCode',width:25 },{ key:'branchName',width:25 },
    { key:'voucherAmount',width:15 },{ key:'startDate',width:15 },{ key:'endDate',width:15 },
    { key:'additionalInfo',width:40 },
  ];
  voucherCodes.forEach((v, i) => ws.addRow({
    no: i + 1, voucherCode: v.voucherCode, branchName: v.branchName,
    voucherAmount: v.voucherAmount, startDate, endDate, additionalInfo,
  }));
  await wb.xlsx.writeFile(filePath);
}

// ─── Single Mode ──────────────────────────────────────────────────────────────

async function processSingle(data, baseDir) {
  const { branchName, branchCode, voucherPrefix, voucherLength, startDay, startMonth,
          endDay, endMonth, year, minSales, vouchers, notes, canUseOnBranch } = data;

  const monthCode    = startDay + startMonth.charAt(0).toUpperCase();
  const notesValue   = notes || `Voucher ${branchName}`;
  const branchFolder = branchName.replace(/\s+/g, '-');
  const canUseBranch = canUseOnBranch || branchName;

  const voucherDir = path.join(baseDir, branchFolder, 'Voucher');
  fs.mkdirSync(voucherDir, { recursive: true });
  const voucherFileName = `${startDay}-${startMonth}-${endDay}-${endMonth}-${year}.xlsx`;
  const voucherFilePath = path.join(voucherDir, voucherFileName);

  let rowNumber = 1;
  const rows = [];
  vouchers.forEach(v => {
    const amountK = Math.floor(v.amount / 1000) + 'K';
    for (let i = 0; i < v.quantity; i++) {
      const code = `${voucherPrefix}${amountK}${monthCode}${randomLetters(2)}${branchCode}${randomNumbers(4)}`;
      rows.push({ no: rowNumber++, voucherType: 'Grand Total', voucherCode: code,
        branchName, voucherLength, minimumSales: minSales,
        voucherAmount: v.amount, voucherSalesPrice: v.amount,
        notes: notesValue, canUseOnBranch: canUseBranch });
    }
  });
  await writeVoucherWorkbook(rows, voucherFilePath);

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(voucherFilePath);
  const ws2 = wb2.getWorksheet('Vouchers');
  const voucherCodes = [];
  ws2.eachRow((row, rn) => {
    if (rn > 1) {
      const code = row.getCell(3).value;
      const name = row.getCell(4).value;
      const amt  = row.getCell(7).value;
      if (code) voucherCodes.push({ voucherCode: code, branchName: name, voucherAmount: amt });
    }
  });

  const activatorDir = path.join(baseDir, branchFolder, 'Activator');
  fs.mkdirSync(activatorDir, { recursive: true });
  const activatorFileName = `Activator-${startDay}-${startMonth}-${endDay}-${endMonth}-${year}.xlsx`;
  const activatorFilePath = path.join(activatorDir, activatorFileName);
  const startDate = formatDate(startDay, startMonth, year);
  const endDate   = formatDate(endDay, endMonth, year);
  await writeActivatorWorkbook(voucherCodes, startDate, endDate, notesValue, activatorFilePath);

  return { branchName, mode: 'single', voucherCount: rows.length };
}

// ─── Multiple Mode ────────────────────────────────────────────────────────────

async function processMultiple(data, baseDir) {
  const { branchName, branchCode, voucherPrefix, voucherLength, startDay, startMonth,
          endDay, endMonth, year, minSales, vouchers, notes, canUseOnBranch } = data;

  const notesValue   = notes || `Voucher ${branchName}`;
  const branchFolder = branchName.replace(/\s+/g, '-');
  const dates        = generateDateRange(startDay, startMonth, endDay, endMonth, year);
  const canUseBranch = canUseOnBranch || branchName;

  let totalVouchers = 0;

  for (const dateInfo of dates) {
    const voucherDir = path.join(baseDir, branchFolder, 'Voucher', dateInfo.folderName);
    fs.mkdirSync(voucherDir, { recursive: true });
    const voucherFilePath = path.join(voucherDir, `${dateInfo.day}-${dateInfo.month}-${dateInfo.year}.xlsx`);

    let rowNumber = 1;
    const rows = [];
    vouchers.forEach(v => {
      const amountK = Math.floor(v.amount / 1000) + 'K';
      for (let i = 0; i < v.quantity; i++) {
        const code = `${voucherPrefix}${amountK}${dateInfo.monthCode}${randomLetters(2)}${branchCode}${randomNumbers(4)}`;
        rows.push({ no: rowNumber++, voucherType: 'Grand Total', voucherCode: code,
          branchName, voucherLength, minimumSales: minSales,
          voucherAmount: v.amount, voucherSalesPrice: v.amount,
          notes: notesValue, canUseOnBranch: canUseBranch });
      }
    });
    await writeVoucherWorkbook(rows, voucherFilePath);
    totalVouchers += rows.length;

    const activatorDir = path.join(baseDir, branchFolder, 'Activator', dateInfo.folderName);
    fs.mkdirSync(activatorDir, { recursive: true });
    const activatorFilePath = path.join(activatorDir, `Activator-${dateInfo.day}-${dateInfo.month}-${dateInfo.year}.xlsx`);
    const voucherCodes = rows.map(r => ({ voucherCode: r.voucherCode, branchName: r.branchName, voucherAmount: r.voucherAmount }));
    await writeActivatorWorkbook(voucherCodes, dateInfo.dateFormatted, dateInfo.dateFormatted, notesValue, activatorFilePath);
  }

  return { branchName, mode: 'multiple', voucherCount: totalVouchers, days: dates.length };
}

// ─── Zip ──────────────────────────────────────────────────────────────────────

function compressToZip(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

// ─── Main Entry ───────────────────────────────────────────────────────────────

async function generateVouchers(input, baseDir) {
  const { singleCommands, regularCommands } = parseGenerateInput(input);
  fs.mkdirSync(baseDir, { recursive: true });

  const summary = [];

  for (const data of singleCommands) {
    const result = await processSingle(data, baseDir);
    summary.push(`✓ ${result.branchName} [single] — ${result.voucherCount} voucher`);
  }

  for (const data of regularCommands) {
    const result = await processMultiple(data, baseDir);
    summary.push(`✓ ${result.branchName} [multiple] — ${result.voucherCount} voucher, ${result.days} hari`);
  }

  const zipPath = baseDir + '.zip';
  await compressToZip(baseDir, zipPath);

  return { zipPath, summary };
}

module.exports = { generateVouchers, parseGenerateInput };
