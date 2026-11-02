// Export helpers for the droplet detail page. Libraries are loaded on demand to keep the main bundle small.

const SOURCE_NAMES = {
  invoice: 'Invoiced',
  preview: 'Month to date',
  estimate: 'Estimated'
};

const CURRENCY_FORMAT = '"$"#,##0.00';

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const styleHeaderRow = (row) => {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0069FF' } };
  row.alignment = { vertical: 'middle' };
};

/**
 * Export to Excel with two sheets:
 * - "Month-wise Summary": one row per droplet, one column per month, plus invoiced / not invoiced / total columns and a total row
 * - "Monthly Totals": one row per month with invoiced / not invoiced / total and the payment method(s)
 * - "By Payment Method": total per payment method, split by droplet
 * - "Line Items": one row per droplet per month per product, with the data source
 */
// "Visa 4242" or "Visa 4242 (60%), MC 1881 (40%)" when an invoice was split across methods
const describePayments = (month) => {
  const payments = month.payments || [];
  if (payments.length <= 1) return payments[0]?.method || 'Unknown';
  return payments.map(payment => `${payment.method} (${Math.round(payment.fraction * 100)}%)`).join(', ');
};

export const exportDropletCostsToExcel = async ({ droplets, months, totalCost, invoicedCost, uninvoicedCost, paymentTotals = [], formatPeriod, filename }) => {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const summary = workbook.addWorksheet('Month-wise Summary', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  const infoColumns = ['Droplet', 'Region', 'Slug', 'Created', 'Rate / Month'];
  const header = summary.addRow([...infoColumns, ...months.map(month => formatPeriod(month.period)), 'Invoiced', 'Not Invoiced', 'Total']);
  styleHeaderRow(header);

  droplets.forEach(droplet => {
    summary.addRow([
      droplet.name,
      droplet.regionName,
      droplet.size,
      new Date(droplet.created_at),
      droplet.monthly_price,
      ...months.map(month => month.droplets[droplet.id]?.amount ?? null),
      droplet.invoicedCost,
      droplet.uninvoicedCost,
      droplet.totalCost
    ]);
  });

  const totalRow = summary.addRow([
    'Total',
    '',
    '',
    null,
    droplets.reduce((sum, droplet) => sum + droplet.monthly_price, 0),
    ...months.map(month => month.amount),
    invoicedCost,
    uninvoicedCost,
    totalCost
  ]);
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };

  summary.getColumn(1).width = 30;
  summary.getColumn(2).width = 14;
  summary.getColumn(3).width = 16;
  summary.getColumn(4).width = 12;
  summary.getColumn(4).numFmt = 'yyyy-mm-dd';
  const lastColumn = infoColumns.length + months.length + 3;
  for (let col = 5; col <= lastColumn; col++) {
    summary.getColumn(col).numFmt = CURRENCY_FORMAT;
    summary.getColumn(col).width = col > lastColumn - 3 ? 14 : 12;
  }
  summary.getColumn(5).width = 14;
  
  const monthlyTotals = workbook.addWorksheet('Monthly Totals', { views: [{ state: 'frozen', ySplit: 1 }] });
  styleHeaderRow(monthlyTotals.addRow(['Month', 'Invoiced', 'Not Invoiced', 'Total', 'Paid With']));
  months.forEach(month => {
    monthlyTotals.addRow([formatPeriod(month.period), month.invoicedAmount, month.uninvoicedAmount, month.amount, describePayments(month)]);
  });
  const monthlyTotalRow = monthlyTotals.addRow(['Total', invoicedCost, uninvoicedCost, totalCost]);
  monthlyTotalRow.font = { bold: true };
  monthlyTotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  monthlyTotals.getColumn(1).width = 12;
  [2, 3, 4].forEach(col => {
    monthlyTotals.getColumn(col).numFmt = CURRENCY_FORMAT;
    monthlyTotals.getColumn(col).width = 14;
  });
  monthlyTotals.getColumn(5).width = 40;
  
  // Payment method x droplet matrix, using each month's split across methods
  const methodSheet = workbook.addWorksheet('By Payment Method', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  styleHeaderRow(methodSheet.addRow(['Payment Method', ...droplets.map(droplet => droplet.name), 'Total', 'Share']));
  paymentTotals.forEach(({ method, amount }) => {
    const perDroplet = droplets.map(droplet => months.reduce((sum, month) => {
      const cost = month.droplets[droplet.id];
      const payment = (month.payments || []).find(p => p.method === method);
      return sum + (cost && payment ? cost.amount * payment.fraction : 0);
    }, 0));
    methodSheet.addRow([method, ...perDroplet, amount, totalCost > 0 ? amount / totalCost : 0]);
  });
  const methodTotalRow = methodSheet.addRow(['Total', ...droplets.map(droplet => droplet.totalCost), totalCost, 1]);
  methodTotalRow.font = { bold: true };
  methodTotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  methodSheet.getColumn(1).width = 24;
  for (let col = 2; col <= droplets.length + 2; col++) {
    methodSheet.getColumn(col).numFmt = CURRENCY_FORMAT;
    methodSheet.getColumn(col).width = 16;
  }
  methodSheet.getColumn(droplets.length + 3).numFmt = '0.0%';
  methodSheet.getColumn(droplets.length + 3).width = 10;

  const lineItems = workbook.addWorksheet('Line Items', { views: [{ state: 'frozen', ySplit: 1 }] });
  styleHeaderRow(lineItems.addRow(['Month', 'Droplet', 'Product', 'Source', 'Amount', 'Paid With']));

  months.forEach(month => {
    droplets.forEach(droplet => {
      const cost = month.droplets[droplet.id];
      if (!cost) return;

      const products = Object.entries(cost.breakdown);
      if (products.length === 0) {
        lineItems.addRow([formatPeriod(month.period), droplet.name, 'Droplet (estimated)', SOURCE_NAMES[cost.source], cost.amount, describePayments(month)]);
      } else {
        products.forEach(([product, amount]) => {
          lineItems.addRow([formatPeriod(month.period), droplet.name, product, SOURCE_NAMES[cost.source], amount, describePayments(month)]);
        });
      }
    });
  });

  const lineTotal = lineItems.addRow(['Total', '', '', '', totalCost]);
  lineTotal.font = { bold: true };
  lineItems.columns.forEach((column, index) => {
    column.width = [12, 30, 28, 16, 14, 40][index];
  });
  lineItems.getColumn(5).numFmt = CURRENCY_FORMAT;

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${filename}.xlsx`
  );
};
