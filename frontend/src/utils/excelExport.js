// Generic "tables to .xlsx" export. ExcelJS is loaded on demand to keep the main bundle small.

const CURRENCY_FORMAT = '"$"#,##0.00';

/**
 * @param {{
 *   name: string,
 *   columns: { header: string, key: string, width?: number, currency?: boolean }[],
 *   rows: object[],
 *   totalRow?: object
 * }[]} sheets  rows are plain objects keyed by column key
 * @param {string} filename  without extension
 */
export const exportSheetsToExcel = async (sheets, filename) => {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  sheets.forEach(({ name, columns, rows, totalRow }) => {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map(column => ({ header: column.header, key: column.key, width: column.width || 18 }));
    rows.forEach(row => sheet.addRow(row));

    if (totalRow) {
      const total = sheet.addRow(totalRow);
      total.font = { bold: true };
      total.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    }

    columns.forEach((column, index) => {
      if (column.currency) sheet.getColumn(index + 1).numFmt = CURRENCY_FORMAT;
    });

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0069FF' } };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/**
 * Single-sheet shortcut.
 * @param {string} sheetName
 * @param {{ header: string, key: string, width?: number, currency?: boolean }[]} columns
 * @param {object[]} rows
 * @param {string} filename  without extension
 */
export const exportRowsToExcel = (sheetName, columns, rows, filename) =>
  exportSheetsToExcel([{ name: sheetName, columns, rows }], filename);
