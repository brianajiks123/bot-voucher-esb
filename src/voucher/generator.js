const ExcelJS = require('exceljs');
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

function formatDate(day, month, year) {
  const dd = String(day).padStart(2, '0');
  const mm = String(getMonthNumber(month) + 1).padStart(2, '0');
  return `${dd}/${mm}/${year}`;
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

const MAX_CODE_LENGTH = 20;

/**
 * Build a voucher code that fits within MAX_CODE_LENGTH characters.
 * Fixed parts: amountK + monthCode + 2 random letters + 4 random numbers = ~9-10 chars
 * Remaining budget is split between prefix and branchCode (truncated if needed).
 */
function buildVoucherCode(voucherPrefix, amountK, monthCode, branchCode) {
  const fixedPart   = amountK + monthCode + randomLetters(2) + randomNumbers(4);
  const budget      = MAX_CODE_LENGTH - fixedPart.length;

  // Reserve at least 2 chars for branchCode, rest goes to prefix
  const branchMax   = Math.min(branchCode.length, Math.max(2, Math.floor(budget / 2)));
  const prefixMax   = budget - branchMax;

  const pfx    = voucherPrefix.substring(0, Math.max(0, prefixMax));
  const branch = branchCode.substring(0, branchMax);

  const code = `${pfx}${amountK}${monthCode}${randomLetters(2)}${branch}${randomNumbers(4)}`;

  // Safety: hard-truncate if still over limit (edge case)
  return code.substring(0, MAX_CODE_LENGTH);
}

function buildVoucherRows(data, monthCode) {
  const { branchName, branchCode, voucherPrefix, voucherLength, minSales, vouchers, notes, canUseOnBranch } = data;
  const notesValue   = notes || `Voucher ${branchName}`;
  const canUseBranch = canUseOnBranch || branchName;
  const rows = [];
  let rowNumber = 1;

  vouchers.forEach((v) => {
    const amountK = Math.floor(v.amount / 1000) + 'K';
    for (let i = 0; i < v.quantity; i++) {
      const code = buildVoucherCode(voucherPrefix, amountK, monthCode, branchCode);
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

async function readVoucherCodesFromFile(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet('Vouchers');
  const codes = [];
  ws.eachRow((row, rn) => {
    if (rn > 1) {
      const code = row.getCell(3).value;
      const name = row.getCell(4).value;
      const amt  = row.getCell(7).value;
      if (code) codes.push({ voucherCode: code, branchName: name, voucherAmount: amt });
    }
  });
  return codes;
}

// ─── Single Mode ──────────────────────────────────────────────────────────────

async function processSingle(data, baseDir) {
  const { branchName, startDay, startMonth, endDay, endMonth, year } = data;
  const monthCode    = startDay + startMonth.charAt(0).toUpperCase();
  const branchFolder = branchName.replace(/\s+/g, '-');
  const notesValue   = data.notes || `Voucher ${branchName}`;

  const voucherDir  = path.join(baseDir, branchFolder, 'Voucher');
  fs.mkdirSync(voucherDir, { recursive: true });
  const voucherFilePath = path.join(voucherDir, `${startDay}-${startMonth}-${endDay}-${endMonth}-${year}.xlsx`);

  const rows = buildVoucherRows(data, monthCode);
  await writeVoucherWorkbook(rows, voucherFilePath);

  const voucherCodes = await readVoucherCodesFromFile(voucherFilePath);

  const activatorDir = path.join(baseDir, branchFolder, 'Activator');
  fs.mkdirSync(activatorDir, { recursive: true });
  const activatorFilePath = path.join(activatorDir, `Activator-${startDay}-${startMonth}-${endDay}-${endMonth}-${year}.xlsx`);
  await writeActivatorWorkbook(
    voucherCodes,
    formatDate(startDay, startMonth, year),
    formatDate(endDay, endMonth, year),
    notesValue,
    activatorFilePath
  );

  return { branchName, mode: 'single', voucherCount: rows.length };
}

// ─── Multiple Mode ────────────────────────────────────────────────────────────

async function processMultiple(data, baseDir) {
  const { branchName, startDay, startMonth, endDay, endMonth, year } = data;
  const branchFolder = branchName.replace(/\s+/g, '-');
  const notesValue   = data.notes || `Voucher ${branchName}`;
  const dates        = generateDateRange(startDay, startMonth, endDay, endMonth, year);
  let totalVouchers  = 0;

  for (const dateInfo of dates) {
    const voucherDir = path.join(baseDir, branchFolder, 'Voucher', dateInfo.folderName);
    fs.mkdirSync(voucherDir, { recursive: true });
    const voucherFilePath = path.join(voucherDir, `${dateInfo.day}-${dateInfo.month}-${dateInfo.year}.xlsx`);

    const rows = buildVoucherRows(data, dateInfo.monthCode);
    await writeVoucherWorkbook(rows, voucherFilePath);
    totalVouchers += rows.length;

    const activatorDir = path.join(baseDir, branchFolder, 'Activator', dateInfo.folderName);
    fs.mkdirSync(activatorDir, { recursive: true });
    const activatorFilePath = path.join(activatorDir, `Activator-${dateInfo.day}-${dateInfo.month}-${dateInfo.year}.xlsx`);
    const voucherCodes = rows.map((r) => ({ voucherCode: r.voucherCode, branchName: r.branchName, voucherAmount: r.voucherAmount }));
    await writeActivatorWorkbook(voucherCodes, dateInfo.dateFormatted, dateInfo.dateFormatted, notesValue, activatorFilePath);
  }

  return { branchName, mode: 'multiple', voucherCount: totalVouchers, days: dates.length };
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
