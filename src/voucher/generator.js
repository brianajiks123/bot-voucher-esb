const fs = require('fs');
const path = require('path');
const { parseGenerateInput, MONTH_MAP, MONTH_NAMES } = require('./parser');
const { writeVoucherWorkbook, writeActivatorWorkbook } = require('./excel');
const { compressToZip } = require('./zip');

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

function generateDateRange(startDay, startMonth, endDay, endMonth, year) {
  const dates = [];
  const start = new Date(year, getMonthNumber(startMonth), startDay);
  const end   = new Date(year, getMonthNumber(endMonth),   endDay);
  let cur = new Date(start);
  while (cur <= end) {
    const monthName = getMonthName(cur.getMonth());
    dates.push({
      day: cur.getDate(), month: monthName, year,
      monthCode:  cur.getDate() + monthName.charAt(0).toUpperCase(),
      folderName: `${cur.getDate()} ${monthName} ${year}`,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

const MAX_CODE_LENGTH = 20;

function buildVoucherCode(voucherPrefix, monthCode) {
  const fixedPart = monthCode + randomLetters(2) + randomNumbers(4);
  const prefixMax = MAX_CODE_LENGTH - fixedPart.length;
  const pfx       = voucherPrefix.substring(0, Math.max(0, prefixMax));

  return `${pfx}${monthCode}${randomLetters(2)}${randomNumbers(4)}`.substring(0, MAX_CODE_LENGTH);
}

function buildVoucherRows(data, monthCode) {
  const { branchName, voucherPrefix, voucherLength, minSales, vouchers, notes, canUseOnBranch } = data;
  const notesValue   = notes || `Voucher ${branchName}`;
  const canUseBranch = canUseOnBranch || branchName;
  const rows = [];
  let rowNumber = 1;

  vouchers.forEach((v) => {
    for (let i = 0; i < v.quantity; i++) {
      const code = buildVoucherCode(voucherPrefix, monthCode);
      rows.push({
        no: rowNumber++, voucherType: 'Grand Total', voucherCode: code,
        branchName, voucherLength, minimumSales: minSales,
        voucherAmount: v.amount, voucherSalesPrice: v.amount,
        notes: notesValue, canUseOnBranch: canUseBranch,
      });
    }
  });
  return rows;
}

// ─── Activation Date Formatter ────────────────────────────────────────────────

function formatActivationDate(day, monthName, year) {
  const monthIdx = getMonthNumber(monthName) + 1; // 1-based
  return `${String(day).padStart(2, '0')}-${String(monthIdx).padStart(2, '0')}-${year}`;
}

// ─── Single Mode ──────────────────────────────────────────────────────────────

async function processSingle(data, baseDir) {
  const { branchName, startDay, startMonth, endDay, endMonth, year, notes, vouchers } = data;
  const monthCode    = startDay + startMonth.charAt(0).toUpperCase();
  const branchFolder = branchName.replace(/\s+/g, '-');

  const voucherDir  = path.join(baseDir, branchFolder, 'Voucher');
  fs.mkdirSync(voucherDir, { recursive: true });
  const voucherFilePath = path.join(voucherDir, `${startDay}-${startMonth}-${endDay}-${endMonth}-${year}.xlsx`);

  const rows = buildVoucherRows(data, monthCode);
  await writeVoucherWorkbook(rows, voucherFilePath);

  const activationDir = path.join(baseDir, branchFolder, 'Activation');
  fs.mkdirSync(activationDir, { recursive: true });
  const activationFilePath = path.join(activationDir, `${startDay}-${startMonth}-${endDay}-${endMonth}-${year}.xlsx`);

  const startDateStr = formatActivationDate(startDay, startMonth, year);
  const endDateStr   = formatActivationDate(endDay, endMonth, year);
  const additionalInfo = notes || `Voucher ${branchName}`;

  const voucherEntries = rows.map((r) => ({
    voucherCode:   r.voucherCode,
    branchName:    r.branchName,
    voucherAmount: r.voucherAmount,
  }));
  await writeActivatorWorkbook(voucherEntries, startDateStr, endDateStr, additionalInfo, activationFilePath);

  return { branchName, mode: 'single', voucherCount: rows.length };
}

// ─── Multiple Mode ────────────────────────────────────────────────────────────

async function processMultiple(data, baseDir) {
  const { branchName, startDay, startMonth, endDay, endMonth, year, notes } = data;
  const branchFolder = branchName.replace(/\s+/g, '-');
  const dates        = generateDateRange(startDay, startMonth, endDay, endMonth, year);
  let totalVouchers  = 0;

  for (const dateInfo of dates) {
    const voucherDir = path.join(baseDir, branchFolder, 'Voucher', dateInfo.folderName);
    fs.mkdirSync(voucherDir, { recursive: true });
    const voucherFilePath = path.join(voucherDir, `${dateInfo.day}-${dateInfo.month}-${dateInfo.year}.xlsx`);

    const rows = buildVoucherRows(data, dateInfo.monthCode);
    await writeVoucherWorkbook(rows, voucherFilePath);
    totalVouchers += rows.length;

    const activationDir = path.join(baseDir, branchFolder, 'Activation', dateInfo.folderName);
    fs.mkdirSync(activationDir, { recursive: true });
    const activationFilePath = path.join(activationDir, `${dateInfo.day}-${dateInfo.month}-${dateInfo.year}.xlsx`);

    const dateStr = formatActivationDate(dateInfo.day, dateInfo.month, dateInfo.year);
    const additionalInfo = notes || `Voucher ${branchName}`;

    const voucherEntries = rows.map((r) => ({
      voucherCode:   r.voucherCode,
      branchName:    r.branchName,
      voucherAmount: r.voucherAmount,
    }));
    await writeActivatorWorkbook(voucherEntries, dateStr, dateStr, additionalInfo, activationFilePath);
  }

  return { branchName, mode: 'multiple', voucherCount: totalVouchers, days: dates.length };
}

// ─── Main Entry ───────────────────────────────────────────────────────────────

async function generateVouchers(input, baseDir, allowPrefix = false) {
  const { singleCommands, regularCommands } = parseGenerateInput(input, allowPrefix);
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
