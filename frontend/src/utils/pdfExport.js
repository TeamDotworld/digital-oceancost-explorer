// Page-to-PDF export. html2canvas and jsPDF are loaded on demand to keep the main bundle small.

// Pages are always rendered at desktop width so a PDF made on a phone has the same table layout
const RENDER_WIDTH = 1280;

/**
 * Capture a rendered page element as-is and save it as a multi-page A4 PDF.
 * Elements marked with data-html2canvas-ignore (buttons and other controls) are left out.
 *
 * @param {HTMLElement} element
 * @param {string} filename  without extension
 * @param {{ orientation?: 'portrait' | 'landscape' }} options
 */
export const exportElementToPdf = async (element, filename, { orientation = 'portrait' } = {}) => {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas-pro'),
    import('jspdf')
  ]);
  
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#f3f4f6',
    windowWidth: RENDER_WIDTH
  });
  
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const margin = 8;
  const pageWidth = pdf.internal.pageSize.getWidth() - margin * 2;
  const pageHeight = pdf.internal.pageSize.getHeight() - margin * 2;
  
  // Height of one PDF page expressed in canvas pixels
  const pageHeightPx = Math.floor((pageHeight * canvas.width) / pageWidth);
  
  for (let offset = 0, page = 0; offset < canvas.height; offset += pageHeightPx, page++) {
    const sliceHeight = Math.min(pageHeightPx, canvas.height - offset);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeight;
    pageCanvas.getContext('2d').drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    
    if (page > 0) pdf.addPage();
    pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.85), 'JPEG', margin, margin, pageWidth, (sliceHeight * pageWidth) / canvas.width);
  }
  
  pdf.save(`${filename}.pdf`);
};
