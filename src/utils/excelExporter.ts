import ExcelJS from 'exceljs';

export interface SpecialPerson {
  id: string;
  name: string;
  albumPrice: number;
}

export interface StudentOverride {
  name?: string;
  albumCost?: number;
  personalCost?: number;
  dedicationCost?: number;
  sonetCost?: number;
  extraText?: string;
  pretExtra?: number;
  greseli?: string;
  folderSeparat?: number | string;
  cosuriScoase?: number | string;
}

export interface CustomSheetRow {
  id: string;
  name: string;
  albumCost: number;
  personalCost: number;
  dedicationCost: number;
  sonetCost: number;
  extraText: string;
  pretExtra: number;
  greseli: string;
  folderSeparat: string;
  cosuriScoase: string;
  customColValues?: Record<string, string | number>;
}

export interface CustomSheetColumn {
  id: string;
  title: string;
}

export interface ClassExcelExportData {
  id: string;
  schoolName: string;
  diriginteName: string;
  studentList: string[];
  priceAlbumMare?: number;
  priceAlbumMic?: number;
  extraPagesPrice?: number;
  enableSonete?: boolean;
  priceSonet?: number;
  albumTypesEnabled?: boolean;
  folderSeparatPrice?: number;
  cosuriScoasePrice?: number;
  extraClassPayment?: number;
  specialPersons?: SpecialPerson[];
  studentPretExtraMap?: Record<string, number>;
  studentGreseliMap?: Record<string, string>;
  studentOverrides?: Record<string, StudentOverride>;
  customRows?: CustomSheetRow[];
  customColumns?: CustomSheetColumn[];
  customColumnValues?: Record<string, Record<string, string | number>>;
}

export const generateClassExcel = async (
  classData: ClassExcelExportData,
  submissionsMap: Record<string, any>
) => {
  const schoolName = classData.schoolName || 'Școală';
  const diriginteName = classData.diriginteName || 'Diriginte';
  const priceMare = classData.priceAlbumMare ?? 150;
  const priceMic = classData.priceAlbumMic ?? 100;
  const pricePages = classData.extraPagesPrice ?? 15;
  const priceSonet = classData.priceSonet ?? 25;
  const isSoneteEnabled = classData.enableSonete !== false;
  const folderSeparat = classData.folderSeparatPrice ?? 0;
  const cosuriScoase = classData.cosuriScoasePrice ?? 0;
  const extraClassPay = classData.extraClassPayment ?? 0;
  const specialPersons = classData.specialPersons || [];
  const overrides = classData.studentOverrides || {};
  const customRows = classData.customRows || [];
  const customColumns = classData.customColumns || [];
  const customColValues = classData.customColumnValues || {};

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Evidență Clasă', {
    views: [{ showGridLines: true }]
  });

  // Base Columns
  const baseHeaders = [
    'Nr/crt',
    'NUME COMPLET',
    'MIC/MARE',
    'PAGINA PERSONALA',
    'PAGINA DEDICATII',
    'SONET',
    'EXTRA',
    'PRET EXTRA',
    'GRESELI',
    'FOLDER SEPARAT POZE',
    'COSURI SCOASE'
  ];

  // Append Dynamic Custom Columns to Headers
  const customHeaders = customColumns.map(c => c.title.toUpperCase());
  const allHeaders = [...baseHeaders, ...customHeaders];

  // Define Column Widths
  const colSpecs = [
    { key: 'num', width: 8 },
    { key: 'name', width: 32 },
    { key: 'micMare', width: 14 },
    { key: 'pagPers', width: 20 },
    { key: 'pagDed', width: 20 },
    { key: 'sonet', width: 14 },
    { key: 'extra', width: 40 },
    { key: 'pretExtra', width: 16 },
    { key: 'greseli', width: 16 },
    { key: 'folderSeparat', width: 24 },
    { key: 'cosuriScoase', width: 20 },
    ...customColumns.map(() => ({ key: 'custom', width: 22 }))
  ];

  worksheet.columns = colSpecs;

  // Add Header Row
  const headerRow = worksheet.addRow(allHeaders);
  headerRow.height = 32;

  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF2994A' }
    };
    cell.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FF000000' }
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'medium', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } }
    };
  });

  let totalAlbumCost = 0;
  let totalPersonalPagesCost = 0;
  let totalDedicationPagesCost = 0;
  let totalSoneteCost = 0;
  let totalPretExtraCost = 0;
  let totalFolderSeparatCost = 0;
  let totalCosuriScoaseCost = 0;

  let rowCounter = 1;

  const styleDataRow = (row: ExcelJS.Row) => {
    row.height = 24;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6ECF5' } };
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } 
      else if (colNumber === 7) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
        cell.font = { name: 'Calibri', size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      } 
      else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        cell.font = { name: 'Calibri', size: 10 };
        cell.alignment = { 
          vertical: 'middle', 
          horizontal: (colNumber === 2 || colNumber === 7) ? 'left' : 'center' 
        };
      }

      cell.border = {
        top: { style: 'thin', color: { argb: 'FFB0C4DE' } },
        left: { style: 'thin', color: { argb: 'FFB0C4DE' } },
        bottom: { style: 'thin', color: { argb: 'FFB0C4DE' } },
        right: { style: 'thin', color: { argb: 'FFB0C4DE' } }
      };
    });
  };

  // 3. Process Regular Students
  classData.studentList.forEach((studentName) => {
    const subKey = `${classData.id}_${studentName}`;
    const sub = submissionsMap[subKey];
    const ovr = overrides[studentName] || {};

    const finalName = ovr.name ?? studentName;

    let autoAlbumCost = 0;
    if (sub) {
      autoAlbumCost = sub.selectedAlbumType === 'mic' ? priceMic : priceMare;
    }
    const albumCost = ovr.albumCost !== undefined ? ovr.albumCost : autoAlbumCost;
    totalAlbumCost += albumCost;

    const extraPersonalCount = sub?.extraPersonalPagesCount || 0;
    const autoPersonalCost = extraPersonalCount * pricePages;
    const personalPagesCost = ovr.personalCost !== undefined ? ovr.personalCost : autoPersonalCost;
    totalPersonalPagesCost += personalPagesCost;

    const extraDedicationCount = sub?.extraDedicationPagesCount || 0;
    const autoDedicationCost = extraDedicationCount * pricePages;
    const dedicationPagesCost = ovr.dedicationCost !== undefined ? ovr.dedicationCost : autoDedicationCost;
    totalDedicationPagesCost += dedicationPagesCost;

    let autoSonetCost = 0;
    if (isSoneteEnabled && (sub?.wantsSonetPhoto || sub?.wantsSonetCitat || sub?.sonetPhoto)) {
      autoSonetCost = priceSonet;
    }
    const sonetCost = ovr.sonetCost !== undefined ? ovr.sonetCost : autoSonetCost;
    totalSoneteCost += sonetCost;

    let autoExtraText = '0';
    if (sub?.extraItemsText && sub.extraItemsText.trim().length > 0) {
      autoExtraText = sub.extraItemsText.trim();
    } else if (sub?.wantsExtraItems) {
      autoExtraText = 'Da';
    }
    const extraText = ovr.extraText !== undefined ? ovr.extraText : autoExtraText;

    const pretExtra = ovr.pretExtra !== undefined ? ovr.pretExtra : (classData.studentPretExtraMap?.[studentName] || 0);
    totalPretExtraCost += pretExtra;

    const greseli = ovr.greseli !== undefined ? ovr.greseli : (classData.studentGreseliMap?.[studentName] || '');

    const fSepVal = ovr.folderSeparat !== undefined ? ovr.folderSeparat : (folderSeparat > 0 ? folderSeparat : 'X');
    if (typeof fSepVal === 'number') totalFolderSeparatCost += fSepVal;

    const cScoaseVal = ovr.cosuriScoase !== undefined ? ovr.cosuriScoase : (cosuriScoase > 0 ? cosuriScoase : 'Y');
    if (typeof cScoaseVal === 'number') totalCosuriScoaseCost += cScoaseVal;

    // Custom column values for this student
    const studentCustoms = customColumns.map(col => {
      const val = customColValues[studentName]?.[col.id];
      return val !== undefined ? val : '0';
    });

    const row = worksheet.addRow([
      rowCounter++,
      finalName,
      albumCost,
      personalPagesCost,
      dedicationPagesCost,
      sonetCost,
      extraText,
      pretExtra,
      greseli,
      fSepVal,
      cScoaseVal,
      ...studentCustoms
    ]);

    styleDataRow(row);
  });

  // 4. Add Diriginte Row
  const hasDiriginteInSpecial = specialPersons.some(p => p.name.toUpperCase().includes('DIRIGINTE'));
  if (!hasDiriginteInSpecial) {
    const dirOvr = overrides['!DIRIGINTE'] || {};
    const dirCustoms = customColumns.map(col => {
      const val = customColValues['!DIRIGINTE']?.[col.id];
      return val !== undefined ? val : '0';
    });

    const dirRow = worksheet.addRow([
      rowCounter++,
      dirOvr.name ?? `! DIRIGINTE (${diriginteName})`,
      dirOvr.albumCost ?? 0,
      dirOvr.personalCost ?? 0,
      dirOvr.dedicationCost ?? 0,
      dirOvr.sonetCost ?? 0,
      dirOvr.extraText ?? '0',
      dirOvr.pretExtra ?? 0,
      dirOvr.greseli ?? '',
      dirOvr.folderSeparat ?? (folderSeparat > 0 ? folderSeparat : 'X'),
      dirOvr.cosuriScoase ?? (cosuriScoase > 0 ? cosuriScoase : 'Y'),
      ...dirCustoms
    ]);
    styleDataRow(dirRow);
  }

  // 5. Special Persons
  specialPersons.forEach((person) => {
    const pOvr = overrides[person.name] || {};
    const cost = pOvr.albumCost !== undefined ? pOvr.albumCost : (Number(person.albumPrice) || 0);
    totalAlbumCost += cost;

    const specCustoms = customColumns.map(col => {
      const val = customColValues[person.name]?.[col.id];
      return val !== undefined ? val : '0';
    });

    const specRow = worksheet.addRow([
      rowCounter++,
      pOvr.name ?? person.name,
      cost,
      pOvr.personalCost ?? 0,
      pOvr.dedicationCost ?? 0,
      pOvr.sonetCost ?? 0,
      pOvr.extraText ?? '0',
      pOvr.pretExtra ?? 0,
      pOvr.greseli ?? '',
      pOvr.folderSeparat ?? (folderSeparat > 0 ? folderSeparat : 'X'),
      pOvr.cosuriScoase ?? (cosuriScoase > 0 ? cosuriScoase : 'Y'),
      ...specCustoms
    ]);
    styleDataRow(specRow);
  });

  // 6. Custom Admin Added Rows
  customRows.forEach((cRow) => {
    totalAlbumCost += Number(cRow.albumCost) || 0;
    totalPersonalPagesCost += Number(cRow.personalCost) || 0;
    totalDedicationPagesCost += Number(cRow.dedicationCost) || 0;
    totalSoneteCost += Number(cRow.sonetCost) || 0;
    totalPretExtraCost += Number(cRow.pretExtra) || 0;

    const rowCustoms = customColumns.map(col => {
      const val = cRow.customColValues?.[col.id];
      return val !== undefined ? val : '0';
    });

    const row = worksheet.addRow([
      rowCounter++,
      cRow.name,
      cRow.albumCost,
      cRow.personalCost,
      cRow.dedicationCost,
      cRow.sonetCost,
      cRow.extraText,
      cRow.pretExtra,
      cRow.greseli,
      cRow.folderSeparat,
      cRow.cosuriScoase,
      ...rowCustoms
    ]);

    styleDataRow(row);
  });

  // Separator Rows
  worksheet.addRow([]);
  worksheet.addRow([]);

  // Plăți Extra Row
  const totalCols = allHeaders.length;
  const labelColIndex = Math.max(1, totalCols - 1);

  const noteRowValues = new Array(totalCols).fill('');
  noteRowValues[labelColIndex - 1] = 'PLĂȚI EXTRA (TRANSPORT / ÎNTÂRZIERE):';
  noteRowValues[totalCols - 1] = extraClassPay;

  const noteRow = worksheet.addRow(noteRowValues);
  noteRow.height = 28;

  const extraPayLabelCell = noteRow.getCell(labelColIndex);
  extraPayLabelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF000000' } };
  extraPayLabelCell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };

  const extraPayValCell = noteRow.getCell(totalCols);
  extraPayValCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF000000' } };
  extraPayValCell.alignment = { vertical: 'middle', horizontal: 'center' };

  worksheet.addRow([]);

  // Grand Total Row
  const grandTotal = totalAlbumCost + totalPersonalPagesCost + totalDedicationPagesCost + totalSoneteCost + totalPretExtraCost + (classData.studentList.length * folderSeparat) + (classData.studentList.length * cosuriScoase) + extraClassPay;

  const totalRowValues = new Array(totalCols).fill('');
  totalRowValues[labelColIndex - 1] = 'TOTAL GENERAL (LEI):';
  totalRowValues[totalCols - 1] = grandTotal;

  const totalRow = worksheet.addRow(totalRowValues);
  totalRow.height = 28;

  const totalLabelCell = totalRow.getCell(labelColIndex);
  totalLabelCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFCC0000' } };
  totalLabelCell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };

  const totalValCell = totalRow.getCell(totalCols);
  totalValCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD700' } };
  totalValCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF000000' } };
  totalValCell.alignment = { vertical: 'middle', horizontal: 'center' };
  totalValCell.border = {
    top: { style: 'medium', color: { argb: 'FF000000' } },
    left: { style: 'medium', color: { argb: 'FF000000' } },
    bottom: { style: 'medium', color: { argb: 'FF000000' } },
    right: { style: 'medium', color: { argb: 'FF000000' } }
  };

  // Generate Buffer & Trigger Browser Download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  const cleanSchool = schoolName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  anchor.download = `Excel_${cleanSchool}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
};
