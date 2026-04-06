const ExcelJS = require('exceljs');

const VOUCHER_COLUMNS = [
  { header: 'No',                    key: 'no',               width: 5  },
  { header: 'Voucher Type',          key: 'voucherType',      width: 15 },
  { header: 'Voucher Code',          key: 'voucherCode',      width: 25 },
  { header: 'Branch Name',           key: 'branchName',       width: 25 },
  { header: 'Voucher Length',        key: 'voucherLength',    width: 15 },
  { header: 'Minimum Sales Amount',  key: 'minimumSales',     width: 20 },
  { header: 'Voucher Amount',        key: 'voucherAmount',    width: 15 },
  { header: 'Voucher Sales Price',   key: 'voucherSalesPrice',width: 20 },
  { header: 'Notes',                 key: 'notes',            width: 30 },
  { header: 'Can Use on Branch (s)', key: 'canUseOnBranch',   width: 30 },
];

async function writeVoucherWorkbook(rows, filePath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Vouchers');
  ws.columns = VOUCHER_COLUMNS;
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
  await wb.xlsx.writeFile(filePath);
}

async function writeActivatorWorkbook(voucherCodes, startDate, endDate, additionalInfo, filePath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Activator');
  ws.addRow([]); ws.addRow([]); ws.addRow([]);
  const hdr = ws.addRow(['#', 'Voucher Code', 'Branch Name', 'Voucher Amount', 'Start Date', 'End Date', 'Additional Information']);
  hdr.font = { bold: true };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
  ws.columns = [
    { key: 'no', width: 5 }, { key: 'voucherCode', width: 25 }, { key: 'branchName', width: 25 },
    { key: 'voucherAmount', width: 15 }, { key: 'startDate', width: 15 }, { key: 'endDate', width: 15 },
    { key: 'additionalInfo', width: 40 },
  ];
  voucherCodes.forEach((v, i) => ws.addRow({
    no: i + 1, voucherCode: v.voucherCode, branchName: v.branchName,
    voucherAmount: v.voucherAmount, startDate, endDate, additionalInfo,
  }));
  await wb.xlsx.writeFile(filePath);
}

module.exports = { writeVoucherWorkbook, writeActivatorWorkbook };
