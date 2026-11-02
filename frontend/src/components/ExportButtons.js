import React, { useState } from 'react';
import { exportElementToPdf } from '../utils/pdfExport';

/**
 * "Export Excel" and "Export PDF" buttons. Both export exactly what the page currently shows,
 * so a filtered page exports the filtered data and an unfiltered page exports everything.
 *
 * @param {() => Promise<void>} [onExcel]  builds and downloads the Excel file
 * @param {React.RefObject} pdfTarget  element captured for the PDF
 * @param {string | (() => string)} filename  base filename without extension
 * @param {'portrait' | 'landscape'} [pdfOrientation]
 */
const ExportButtons = ({ onExcel, pdfTarget, filename, pdfOrientation = 'landscape', disabled = false }) => {
  const [busy, setBusy] = useState(null);
  
  const run = async (kind, action) => {
    setBusy(kind);
    try {
      await action();
    } catch (error) {
      console.error(`${kind} export failed:`, error);
      alert(`${kind === 'excel' ? 'Excel' : 'PDF'} export failed. Please try again.`);
    } finally {
      setBusy(null);
    }
  };
  
  const baseName = () => (typeof filename === 'function' ? filename() : filename);
  
  return (
    <div className="flex flex-wrap gap-2" data-html2canvas-ignore="true">
      {onExcel && (
        <button
          type="button"
          onClick={() => run('excel', onExcel)}
          disabled={disabled || busy !== null}
          className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {busy === 'excel' ? 'Exporting...' : 'Export Excel'}
        </button>
      )}
      <button
        type="button"
        onClick={() => run('pdf', () => exportElementToPdf(pdfTarget.current, baseName(), { orientation: pdfOrientation }))}
        disabled={disabled || busy !== null}
        className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
      >
        {busy === 'pdf' ? 'Exporting...' : 'Export PDF'}
      </button>
    </div>
  );
};

export default ExportButtons;
