import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, collection, query, where, onSnapshot, updateDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../../firebase/config';
import { FileText, Download, Printer, Check, Copy, Shield, Save, Plus, Trash2, Edit, X } from 'lucide-react';
import { generateClassExcel, type StudentOverride, type CustomSheetRow, type CustomSheetColumn } from '../../utils/excelExporter';
import { parseMoney, getLegacyTextNote, computeRowTotal, parseStrictMoney } from '../../utils/sheetTotals';

interface SpecialPerson {
  id: string;
  name: string;
  albumPrice: number;
}

interface ClassData {
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

export function ClassSheetView() {
  const { classId } = useParams<{ classId: string }>();
  const [classData, setClassData] = useState<ClassData | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [savingField, setSavingField] = useState(false);
  const [editingHeaderName, setEditingHeaderName] = useState(false);
  const [headerDiriginteInput, setHeaderDiriginteInput] = useState('');
  const [newColModal, setNewColModal] = useState(false);
  const [newColTitle, setNewColTitle] = useState('');
  const [newColMoneyType, setNewColMoneyType] = useState<'lei' | 'info'>('info');

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setIsAdmin(!!user);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!classId) return;

    const docRef = doc(db, 'classes', classId);
    const unsubClass = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = { id: docSnap.id, ...docSnap.data() } as ClassData;
        setClassData(data);
        setHeaderDiriginteInput(data.diriginteName || '');
      }
      setLoading(false);
    });

    const q = query(collection(db, 'submissions'), where('classId', '==', classId));
    const unsubSub = onSnapshot(q, (snapshot) => {
      const subMap: Record<string, any> = {};
      snapshot.docs.forEach((d) => {
        const data = d.data();
        if (data.studentName) {
          subMap[`${classId}_${data.studentName}`] = data;
        }
      });
      setSubmissions(subMap);
    });

    return () => {
      unsubClass();
      unsubSub();
    };
  }, [classId]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#121110', color: '#FAF9F6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Calibri, sans-serif' }}>
        <p style={{ fontSize: '16px' }}>Se încarcă documentul de confirmare...</p>
      </div>
    );
  }

  if (!classData) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#121110', color: '#FAF9F6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Calibri, sans-serif' }}>
        <p style={{ fontSize: '16px', color: '#FF6B6B' }}>Clasa nu a fost găsită sau link-ul este invalid.</p>
      </div>
    );
  }

  const priceMare = classData.priceAlbumMare ?? 150;
  const priceMic = classData.priceAlbumMic ?? 100;
  const pricePages = classData.extraPagesPrice ?? 15;
  const priceSonet = classData.priceSonet ?? 25;
  const isSoneteEnabled = classData.enableSonete !== false;
  const folderSeparat = classData.folderSeparatPrice ?? 0;
  const cosuriScoase = classData.cosuriScoasePrice ?? 0;
  const extraClassPay = classData.extraClassPayment ?? 0;
  const overrides = classData.studentOverrides || {};
  const customRows = classData.customRows || [];
  const customColumns = classData.customColumns || [];
  const customColValues = classData.customColumnValues || {};

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Generic cell update for any student override
  const updateStudentCell = async (studentKey: string, field: keyof StudentOverride, val: any) => {
    if (!isAdmin || !classData) return;
    setSavingField(true);
    try {
      const existing = overrides[studentKey] || {};
      const updatedOverrides = {
        ...overrides,
        [studentKey]: {
          ...existing,
          [field]: val
        }
      };
      await updateDoc(doc(db, 'classes', classData.id), { studentOverrides: updatedOverrides });
    } catch (err) {
      console.error('Eroare la salvarea celulei:', err);
    } finally {
      setSavingField(false);
    }
  };

  // Generic cell update for dynamic custom columns
  const updateCustomColumnValue = async (studentKey: string, colId: string, val: any) => {
    if (!isAdmin || !classData) return;
    setSavingField(true);
    try {
      const existingStudentCustoms = customColValues[studentKey] || {};
      const updatedCustomColValues = {
        ...customColValues,
        [studentKey]: {
          ...existingStudentCustoms,
          [colId]: val
        }
      };
      await updateDoc(doc(db, 'classes', classData.id), { customColumnValues: updatedCustomColValues });
    } catch (err) {
      console.error('Eroare la salvarea celulei custom:', err);
    } finally {
      setSavingField(false);
    }
  };

  // Save updated diriginte name
  const saveDiriginteName = async () => {
    if (!isAdmin || !classData || !headerDiriginteInput.trim()) return;
    setSavingField(true);
    try {
      await updateDoc(doc(db, 'classes', classData.id), { diriginteName: headerDiriginteInput.trim() });
      setEditingHeaderName(false);
    } catch (err) {
      console.error('Eroare la salvarea dirigintelui:', err);
    } finally {
      setSavingField(false);
    }
  };

  // Add a new custom column
  const handleAddCustomColumn = async () => {
    if (!isAdmin || !classData || !newColTitle.trim()) return;
    setSavingField(true);
    try {
      const newCol: CustomSheetColumn = {
        id: Date.now().toString(),
        title: newColTitle.trim(),
        moneyType: newColMoneyType
      };
      const updatedCols = [...customColumns, newCol];
      await updateDoc(doc(db, 'classes', classData.id), { customColumns: updatedCols });
      setNewColTitle('');
      setNewColMoneyType('info');
      setNewColModal(false);
    } catch (err) {
      console.error('Eroare adăugare coloană nouă:', err);
    } finally {
      setSavingField(false);
    }
  };

  // Remove a custom column
  const handleRemoveCustomColumn = async (colId: string) => {
    if (!isAdmin || !classData) return;
    setSavingField(true);
    try {
      const updatedCols = customColumns.filter(c => c.id !== colId);
      await updateDoc(doc(db, 'classes', classData.id), { customColumns: updatedCols });
    } catch (err) {
      console.error('Eroare ștergere coloană:', err);
    } finally {
      setSavingField(false);
    }
  };

  // Toggle an existing custom column between money ('lei') and informative ('info')
  const handleToggleColumnMoneyType = async (colId: string) => {
    if (!isAdmin || !classData) return;
    setSavingField(true);
    try {
      const updatedCols = customColumns.map(c =>
        c.id === colId
          ? { ...c, moneyType: (c.moneyType === 'lei' ? 'info' : 'lei') as 'lei' | 'info' }
          : c
      );
      await updateDoc(doc(db, 'classes', classData.id), { customColumns: updatedCols });
    } catch (err) {
      console.error('Eroare schimbare tip coloană:', err);
    } finally {
      setSavingField(false);
    }
  };

  // Add a new custom row in table
  const handleAddCustomRow = async () => {
    if (!isAdmin || !classData) return;
    setSavingField(true);
    try {
      const newRow: CustomSheetRow = {
        id: Date.now().toString(),
        name: 'Elev / Persoană Nouă',
        albumCost: priceMare,
        personalCost: 0,
        dedicationCost: 0,
        sonetCost: 0,
        extraText: '0',
        pretExtra: 0,
        greseli: 0,
        folderSeparat: folderSeparat > 0 ? folderSeparat : 0,
        cosuriScoase: cosuriScoase > 0 ? cosuriScoase : 0,
        customColValues: {}
      };
      const updated = [...customRows, newRow];
      await updateDoc(doc(db, 'classes', classData.id), { customRows: updated });
    } catch (err) {
      console.error('Eroare adăugare rând nou:', err);
    } finally {
      setSavingField(false);
    }
  };

  // Update field on custom row
  const updateCustomRowField = async (rowId: string, field: keyof CustomSheetRow, val: any) => {
    if (!isAdmin || !classData) return;
    setSavingField(true);
    try {
      const updated = customRows.map(r => r.id === rowId ? { ...r, [field]: val } : r);
      await updateDoc(doc(db, 'classes', classData.id), { customRows: updated });
    } catch (err) {
      console.error('Eroare modificare rând custom:', err);
    } finally {
      setSavingField(false);
    }
  };

  // Update custom column value on custom row
  const updateCustomRowColValue = async (rowId: string, colId: string, val: any) => {
    if (!isAdmin || !classData) return;
    setSavingField(true);
    try {
      const updated = customRows.map(r => {
        if (r.id === rowId) {
          const updatedCustoms = { ...(r.customColValues || {}), [colId]: val };
          return { ...r, customColValues: updatedCustoms };
        }
        return r;
      });
      await updateDoc(doc(db, 'classes', classData.id), { customRows: updated });
    } catch (err) {
      console.error('Eroare modificare celulă coloană custom rând:', err);
    } finally {
      setSavingField(false);
    }
  };

  // Delete a custom row
  const handleRemoveCustomRow = async (rowId: string) => {
    if (!isAdmin || !classData) return;
    setSavingField(true);
    try {
      const updated = customRows.filter(r => r.id !== rowId);
      await updateDoc(doc(db, 'classes', classData.id), { customRows: updated });
    } catch (err) {
      console.error('Eroare ștergere rând custom:', err);
    } finally {
      setSavingField(false);
    }
  };

  const updateExtraClassPay = async (val: number) => {
    if (!isAdmin || !classData) return;
    setSavingField(true);
    try {
      await updateDoc(doc(db, 'classes', classData.id), { extraClassPayment: val });
    } catch (err) {
      console.error('Eroare salvare plati extra clasa:', err);
    } finally {
      setSavingField(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F4F5F7', color: '#172B4D', fontFamily: 'Calibri, Arial, sans-serif', padding: '20px' }}>
      {/* Top Action & Mode Bar */}
      <div className="no-print" style={{ maxWidth: '1350px', margin: '0 auto 20px auto', backgroundColor: '#FFFFFF', padding: '16px 24px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#091E42', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={20} style={{ color: '#E67E22' }} />
              Document Confirmare Comandă — {classData.schoolName}
            </h1>
            {isAdmin ? (
              <span style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FCD34D', padding: '4px 12px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Shield size={13} /> MOD EDITARE ADMIN ACTIV (SEMI-AUTOMAT)
              </span>
            ) : (
              <span style={{ backgroundColor: '#EBF8FF', color: '#2B6CB0', border: '1px solid #90CDF4', padding: '4px 12px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>
                VIZUALIZARE CLIENT (DOAR CITIRE)
              </span>
            )}
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#5E6C84' }}>
            Diriginte: <strong>{classData.diriginteName}</strong> · Actualizat automat din platformă & editabil pe orice rând/coloană
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {savingField && (
            <span style={{ fontSize: '12px', color: '#D97706', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
              <Save size={14} className="animate-spin" /> Se salvează în DB...
            </span>
          )}

          {isAdmin && (
            <>
              <button
                onClick={() => setNewColModal(true)}
                style={{ backgroundColor: '#D97706', color: '#FFFFFF', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Plus size={15} /> Adaugă Coloană Nouă
              </button>

              <button
                onClick={handleAddCustomRow}
                style={{ backgroundColor: '#1A365D', color: '#FFFFFF', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Plus size={15} /> Adaugă Rând Nou
              </button>
            </>
          )}

          <button
            onClick={handleCopyLink}
            style={{ backgroundColor: '#EDF2F7', border: '1px solid #CBD5E0', color: '#2D3748', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {copied ? <Check size={14} style={{ color: '#38A169' }} /> : <Copy size={14} />}
            {copied ? 'Link Copiat!' : 'Copiază Link Client'}
          </button>
          
          <button
            onClick={() => window.print()}
            style={{ backgroundColor: '#EDF2F7', border: '1px solid #CBD5E0', color: '#2D3748', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Printer size={14} /> Printează / PDF
          </button>

          <button
            onClick={() => generateClassExcel(classData, submissions)}
            style={{ backgroundColor: '#276749', border: 'none', color: '#FFFFFF', padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 2px 6px rgba(39,103,73,0.3)' }}
          >
            <Download size={14} /> Descarcă Excel (.xlsx)
          </button>
        </div>
      </div>

      {/* Main Document Table View (Matching Google Sheets Template 100%) */}
      <div style={{ maxWidth: '1350px', margin: '0 auto', backgroundColor: '#FFFFFF', padding: '24px', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
        
        {/* Document Header Metadata */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', paddingBottom: '12px', borderBottom: '2px solid #E67E22', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', color: '#091E42', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
              EXTRAS CLASĂ: {classData.schoolName}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <span style={{ fontSize: '14px', color: '#5E6C84', fontWeight: 600 }}>DIRIGINTE:</span>
              {isAdmin && editingHeaderName ? (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={headerDiriginteInput}
                    onChange={(e) => setHeaderDiriginteInput(e.target.value)}
                    style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #3182CE', fontSize: '13px', fontWeight: 600 }}
                  />
                  <button onClick={saveDiriginteName} style={{ padding: '4px 10px', backgroundColor: '#3182CE', color: '#FFF', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>Salvează</button>
                </div>
              ) : (
                <span style={{ fontSize: '14px', color: '#091E42', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  {classData.diriginteName}
                  {isAdmin && (
                    <button onClick={() => setEditingHeaderName(true)} style={{ background: 'none', border: 'none', color: '#3182CE', cursor: 'pointer', padding: '2px' }} title="Editează nume diriginte">
                      <Edit size={13} />
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: '12px', color: '#7A869A' }}>
            Data: {new Date().toLocaleDateString('ro-RO')}
          </div>
        </div>

        {/* The Spreadsheet Grid Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontFamily: 'Calibri, Arial, sans-serif' }}>
            <thead>
              <tr style={{ backgroundColor: '#F2994A', color: '#000000', height: '40px', textAlign: 'center', fontWeight: 700 }}>
                <th style={{ border: '1px solid #000000', padding: '6px', width: '50px' }}>Nr/crt</th>
                <th style={{ border: '1px solid #000000', padding: '6px', textAlign: 'left', minWidth: '200px' }}>NUME COMPLET</th>
                <th style={{ border: '1px solid #000000', padding: '6px', width: '90px' }}>MIC/MARE</th>
                <th style={{ border: '1px solid #000000', padding: '6px', width: '120px' }}>PAGINA PERSONALA</th>
                <th style={{ border: '1px solid #000000', padding: '6px', width: '120px' }}>PAGINA DEDICATII</th>
                <th style={{ border: '1px solid #000000', padding: '6px', width: '90px' }}>SONET</th>
                <th style={{ border: '1px solid #000000', padding: '6px', textAlign: 'left', minWidth: '220px', backgroundColor: '#F2994A' }}>EXTRA</th>
                <th style={{ border: '1px solid #000000', padding: '6px', width: '100px' }}>PRET EXTRA</th>
                <th style={{ border: '1px solid #000000', padding: '6px', width: '110px' }}>GRESELI</th>
                <th style={{ border: '1px solid #000000', padding: '6px', width: '130px' }}>FOLDER SEPARAT POZE</th>
                <th style={{ border: '1px solid #000000', padding: '6px', width: '120px' }}>COSURI SCOASE</th>

                {/* Render Dynamic Custom Columns */}
                {customColumns.map((col) => (
                  <th key={col.id} style={{ border: '1px solid #000000', padding: '6px', minWidth: '140px', backgroundColor: '#F2994A', position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
                      <span>{col.title.toUpperCase()}</span>
                      {isAdmin && (
                        <span className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            onClick={() => handleToggleColumnMoneyType(col.id)}
                            title={col.moneyType === 'lei' ? 'Coloană monetară (click pentru a o face informativă)' : 'Coloană informativă (click pentru a o face monetară - LEI)'}
                            style={{
                              fontSize: '9px',
                              padding: '1px 5px',
                              borderRadius: '8px',
                              border: '1px solid #000',
                              cursor: 'pointer',
                              fontWeight: 700,
                              backgroundColor: col.moneyType === 'lei' ? '#276749' : 'transparent',
                              color: col.moneyType === 'lei' ? '#FFF' : '#000'
                            }}
                          >
                            LEI
                          </button>
                          <button
                            onClick={() => handleRemoveCustomColumn(col.id)}
                            style={{ background: 'none', border: 'none', color: '#900', cursor: 'pointer', padding: '2px' }}
                            title="Șterge coloana"
                          >
                            <X size={13} />
                          </button>
                        </span>
                      )}
                    </div>
                  </th>
                ))}

                <th style={{ border: '1px solid #000000', padding: '6px', width: '100px', backgroundColor: '#F2994A' }}>TOTAL</th>

                {isAdmin && <th className="no-print" style={{ border: '1px solid #000000', padding: '6px', width: '50px' }}>Acțiuni</th>}
              </tr>
            </thead>
            <tbody>
              {/* Regular Student Rows */}
              {classData.studentList.map((studentName, idx) => {
                const subKey = `${classData.id}_${studentName}`;
                const sub = submissions[subKey];
                const ovr = overrides[studentName] || {};

                const finalName = ovr.name ?? studentName;

                let autoAlbumCost = 0;
                if (sub) {
                  autoAlbumCost = sub.selectedAlbumType === 'mic' ? priceMic : priceMare;
                }
                const albumCost = ovr.albumCost !== undefined ? ovr.albumCost : autoAlbumCost;

                const autoPersonalCost = (sub?.extraPersonalPagesCount || 0) * pricePages;
                const personalCost = ovr.personalCost !== undefined ? ovr.personalCost : autoPersonalCost;

                const autoDedicationCost = (sub?.extraDedicationPagesCount || 0) * pricePages;
                const dedicationCost = ovr.dedicationCost !== undefined ? ovr.dedicationCost : autoDedicationCost;

                let autoSonetCost = 0;
                if (isSoneteEnabled && (sub?.wantsSonetPhoto || sub?.wantsSonetCitat || sub?.sonetPhoto)) {
                  autoSonetCost = priceSonet;
                }
                const sonetCost = ovr.sonetCost !== undefined ? ovr.sonetCost : autoSonetCost;

                let autoExtraText = '0';
                if (sub?.extraItemsText && sub.extraItemsText.trim().length > 0) {
                  autoExtraText = sub.extraItemsText.trim();
                } else if (sub?.wantsExtraItems) {
                  autoExtraText = 'Da';
                }
                const extraText = ovr.extraText !== undefined ? ovr.extraText : autoExtraText;

                const pretExtraRaw = ovr.pretExtra !== undefined ? ovr.pretExtra : (classData.studentPretExtraMap?.[studentName] || 0);
                const pretExtra = parseMoney(pretExtraRaw);

                const greseliRaw = ovr.greseli !== undefined ? ovr.greseli : (classData.studentGreseliMap?.[studentName] || '');
                const greseli = parseMoney(greseliRaw);
                const greseliNote = getLegacyTextNote(greseliRaw);

                const fSepRaw = ovr.folderSeparat !== undefined ? ovr.folderSeparat : (folderSeparat > 0 ? folderSeparat : '');
                const fSepVal = fSepRaw === '' ? '' : parseMoney(fSepRaw);
                const fSepNote = getLegacyTextNote(fSepRaw);

                const cScoaseRaw = ovr.cosuriScoase !== undefined ? ovr.cosuriScoase : (cosuriScoase > 0 ? cosuriScoase : '');
                const cScoaseVal = cScoaseRaw === '' ? '' : parseMoney(cScoaseRaw);
                const cScoaseNote = getLegacyTextNote(cScoaseRaw);

                const studentCustomVals = customColValues[studentName] || {};
                const extraAmount = parseStrictMoney(extraText);
                const rowTotal = computeRowTotal(
                  [albumCost, personalCost, dedicationCost, sonetCost, extraAmount, pretExtra, greseli, parseMoney(fSepVal), parseMoney(cScoaseVal)],
                  customColumns,
                  studentCustomVals
                );

                return (
                  <tr key={studentName} style={{ height: '32px', color: '#000000' }}>
                    <td style={{ border: '1px solid #B0C4DE', padding: '4px', textAlign: 'center', backgroundColor: '#E6ECF5', fontWeight: 700 }}>
                      {idx + 1}
                    </td>

                    {/* NUME COMPLET */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px 6px', backgroundColor: '#D9E1F2', fontWeight: 500 }}>
                      {isAdmin ? (
                        <input
                          type="text"
                          value={finalName}
                          onChange={(e) => updateStudentCell(studentName, 'name', e.target.value)}
                          style={{ width: '95%', border: '1px dashed #718096', padding: '3px 6px', borderRadius: '3px', fontSize: '12px', fontWeight: 600, backgroundColor: '#FFFFFF' }}
                        />
                      ) : (
                        finalName
                      )}
                    </td>

                    {/* MIC/MARE */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={albumCost}
                          onChange={(e) => updateStudentCell(studentName, 'albumCost', parseInt(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', fontWeight: 600, backgroundColor: '#FFFFFF' }}
                        />
                      ) : (
                        albumCost
                      )}
                    </td>

                    {/* PAGINA PERSONALA */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={personalCost}
                          onChange={(e) => updateStudentCell(studentName, 'personalCost', parseInt(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (
                        personalCost
                      )}
                    </td>

                    {/* PAGINA DEDICATII */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={dedicationCost}
                          onChange={(e) => updateStudentCell(studentName, 'dedicationCost', parseInt(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (
                        dedicationCost
                      )}
                    </td>

                    {/* SONET */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={sonetCost}
                          onChange={(e) => updateStudentCell(studentName, 'sonetCost', parseInt(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (
                        sonetCost
                      )}
                    </td>

                    {/* EXTRA */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px 6px', backgroundColor: '#FCE4D6' }}>
                      {isAdmin ? (
                        <input
                          type="text"
                          value={extraText}
                          onChange={(e) => updateStudentCell(studentName, 'extraText', e.target.value)}
                          style={{ width: '95%', border: '1px dashed #718096', padding: '3px 6px', borderRadius: '3px', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (
                        extraText
                      )}
                    </td>

                    {/* PRET EXTRA */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={pretExtra}
                          onChange={(e) => updateStudentCell(studentName, 'pretExtra', parseFloat(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px solid #3182CE', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', fontWeight: 700, backgroundColor: '#FFFFFF' }}
                        />
                      ) : (
                        pretExtra
                      )}
                    </td>

                    {/* GRESELI (coloană monetară) */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          placeholder="0"
                          value={greseli}
                          title={greseliNote || undefined}
                          onChange={(e) => updateStudentCell(studentName, 'greseli', parseFloat(e.target.value) || 0)}
                          style={{ width: '85%', border: greseliNote ? '1px solid #DD6B20' : '1px solid #3182CE', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (
                        <span title={greseliNote || undefined}>{greseli}</span>
                      )}
                    </td>

                    {/* FOLDER SEPARAT */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={fSepVal}
                          title={fSepNote || undefined}
                          onChange={(e) => updateStudentCell(studentName, 'folderSeparat', parseFloat(e.target.value) || 0)}
                          style={{ width: '85%', border: fSepNote ? '1px solid #DD6B20' : '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (
                        <span title={fSepNote || undefined}>{fSepVal}</span>
                      )}
                    </td>

                    {/* COSURI SCOASE */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={cScoaseVal}
                          title={cScoaseNote || undefined}
                          onChange={(e) => updateStudentCell(studentName, 'cosuriScoase', parseFloat(e.target.value) || 0)}
                          style={{ width: '85%', border: cScoaseNote ? '1px solid #DD6B20' : '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (
                        <span title={cScoaseNote || undefined}>{cScoaseVal}</span>
                      )}
                    </td>

                    {/* Dynamic Custom Column Cells */}
                    {customColumns.map((col) => {
                      const isMoneyCol = col.moneyType === 'lei';
                      const rawVal = studentCustomVals[col.id];
                      const curVal = isMoneyCol ? parseMoney(rawVal) : (rawVal ?? '0');
                      return (
                        <td key={col.id} style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                          {isAdmin ? (
                            <input
                              type={isMoneyCol ? 'number' : 'text'}
                              value={curVal}
                              onChange={(e) => updateCustomColumnValue(studentName, col.id, isMoneyCol ? (parseFloat(e.target.value) || 0) : e.target.value)}
                              style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                            />
                          ) : (
                            curVal
                          )}
                        </td>
                      );
                    })}

                    {/* TOTAL (calculat, needitabil) */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'right', backgroundColor: '#FFF2CC', fontWeight: 700 }}>
                      {rowTotal} LEI
                    </td>

                    {isAdmin && (
                      <td className="no-print" style={{ border: '1px solid #B0C4DE', textAlign: 'center' }}>
                        -
                      </td>
                    )}
                  </tr>
                );
              })}

              {/* Diriginte Row */}
              {(() => {
                const dirOvr = overrides['!DIRIGINTE'] || {};
                const dirName = dirOvr.name ?? `! DIRIGINTE (${classData.diriginteName})`;
                const dirAlbumCost = dirOvr.albumCost ?? 0;
                const dirPersonalCost = dirOvr.personalCost ?? 0;
                const dirDedicationCost = dirOvr.dedicationCost ?? 0;
                const dirSonetCost = dirOvr.sonetCost ?? 0;
                const dirExtraText = dirOvr.extraText ?? '0';
                const dirPretExtra = parseMoney(dirOvr.pretExtra ?? 0);
                const dirGreseliRaw = dirOvr.greseli ?? '';
                const dirGreseli = parseMoney(dirGreseliRaw);
                const dirGreseliNote = getLegacyTextNote(dirGreseliRaw);
                const dirFSepRaw = dirOvr.folderSeparat ?? (folderSeparat > 0 ? folderSeparat : '');
                const dirFSep = dirFSepRaw === '' ? '' : parseMoney(dirFSepRaw);
                const dirFSepNote = getLegacyTextNote(dirFSepRaw);
                const dirCScoaseRaw = dirOvr.cosuriScoase ?? (cosuriScoase > 0 ? cosuriScoase : '');
                const dirCScoase = dirCScoaseRaw === '' ? '' : parseMoney(dirCScoaseRaw);
                const dirCScoaseNote = getLegacyTextNote(dirCScoaseRaw);
                const dirCustomVals = customColValues['!DIRIGINTE'] || {};
                const dirExtraAmount = parseStrictMoney(dirExtraText);
                const dirRowTotal = computeRowTotal(
                  [dirAlbumCost, dirPersonalCost, dirDedicationCost, dirSonetCost, dirExtraAmount, dirPretExtra, dirGreseli, parseMoney(dirFSep), parseMoney(dirCScoase)],
                  customColumns,
                  dirCustomVals
                );

                return (
                  <tr style={{ height: '32px', color: '#000000' }}>
                    <td style={{ border: '1px solid #B0C4DE', padding: '4px', textAlign: 'center', backgroundColor: '#E6ECF5', fontWeight: 700 }}>
                      {classData.studentList.length + 1}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px 6px', backgroundColor: '#D9E1F2', fontWeight: 700 }}>
                      {isAdmin ? (
                        <input
                          type="text"
                          value={dirName}
                          onChange={(e) => updateStudentCell('!DIRIGINTE', 'name', e.target.value)}
                          style={{ width: '95%', border: '1px dashed #718096', padding: '3px 6px', borderRadius: '3px', fontSize: '12px', fontWeight: 700, backgroundColor: '#FFFFFF' }}
                        />
                      ) : (
                        dirName
                      )}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={dirAlbumCost}
                          onChange={(e) => updateStudentCell('!DIRIGINTE', 'albumCost', parseInt(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : dirAlbumCost}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={dirPersonalCost}
                          onChange={(e) => updateStudentCell('!DIRIGINTE', 'personalCost', parseInt(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : dirPersonalCost}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={dirDedicationCost}
                          onChange={(e) => updateStudentCell('!DIRIGINTE', 'dedicationCost', parseInt(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : dirDedicationCost}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={dirSonetCost}
                          onChange={(e) => updateStudentCell('!DIRIGINTE', 'sonetCost', parseInt(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : dirSonetCost}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px 6px', backgroundColor: '#FCE4D6' }}>
                      {isAdmin ? (
                        <input
                          type="text"
                          value={dirExtraText}
                          onChange={(e) => updateStudentCell('!DIRIGINTE', 'extraText', e.target.value)}
                          style={{ width: '95%', border: '1px dashed #718096', padding: '3px 6px', borderRadius: '3px', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : dirExtraText}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={dirPretExtra}
                          onChange={(e) => updateStudentCell('!DIRIGINTE', 'pretExtra', parseFloat(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : dirPretExtra}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={dirGreseli}
                          title={dirGreseliNote || undefined}
                          onChange={(e) => updateStudentCell('!DIRIGINTE', 'greseli', parseFloat(e.target.value) || 0)}
                          style={{ width: '85%', border: dirGreseliNote ? '1px solid #DD6B20' : '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (<span title={dirGreseliNote || undefined}>{dirGreseli}</span>)}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={dirFSep}
                          title={dirFSepNote || undefined}
                          onChange={(e) => updateStudentCell('!DIRIGINTE', 'folderSeparat', parseFloat(e.target.value) || 0)}
                          style={{ width: '85%', border: dirFSepNote ? '1px solid #DD6B20' : '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (<span title={dirFSepNote || undefined}>{dirFSep}</span>)}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={dirCScoase}
                          title={dirCScoaseNote || undefined}
                          onChange={(e) => updateStudentCell('!DIRIGINTE', 'cosuriScoase', parseFloat(e.target.value) || 0)}
                          style={{ width: '85%', border: dirCScoaseNote ? '1px solid #DD6B20' : '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (<span title={dirCScoaseNote || undefined}>{dirCScoase}</span>)}
                    </td>

                    {/* Custom columns for Diriginte */}
                    {customColumns.map((col) => {
                      const isMoneyCol = col.moneyType === 'lei';
                      const rawVal = dirCustomVals[col.id];
                      const curVal = isMoneyCol ? parseMoney(rawVal) : (rawVal ?? '0');
                      return (
                        <td key={col.id} style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                          {isAdmin ? (
                            <input
                              type={isMoneyCol ? 'number' : 'text'}
                              value={curVal}
                              onChange={(e) => updateCustomColumnValue('!DIRIGINTE', col.id, isMoneyCol ? (parseFloat(e.target.value) || 0) : e.target.value)}
                              style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                            />
                          ) : curVal}
                        </td>
                      );
                    })}

                    {/* TOTAL (calculat, needitabil) */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'right', backgroundColor: '#FFF2CC', fontWeight: 700 }}>
                      {dirRowTotal} LEI
                    </td>

                    {isAdmin && <td className="no-print" style={{ border: '1px solid #B0C4DE', textAlign: 'center' }}>-</td>}
                  </tr>
                );
              })()}

              {/* Special Persons Rows */}
              {(classData.specialPersons || []).map((person, pIdx) => {
                const pOvr = overrides[person.name] || {};
                const pName = pOvr.name ?? person.name;
                const pCost = pOvr.albumCost !== undefined ? pOvr.albumCost : person.albumPrice;
                const pPersonalCost = pOvr.personalCost ?? 0;
                const pDedicationCost = pOvr.dedicationCost ?? 0;
                const pSonetCost = pOvr.sonetCost ?? 0;
                const pExtraText = pOvr.extraText ?? '0';
                const pPretExtra = parseMoney(pOvr.pretExtra ?? 0);
                const pGreseliRaw = pOvr.greseli ?? '';
                const pGreseli = parseMoney(pGreseliRaw);
                const pGreseliNote = getLegacyTextNote(pGreseliRaw);
                const pFSepRaw = pOvr.folderSeparat !== undefined ? pOvr.folderSeparat : (folderSeparat > 0 ? folderSeparat : '');
                const pFSep = pFSepRaw === '' ? '' : parseMoney(pFSepRaw);
                const pFSepNote = getLegacyTextNote(pFSepRaw);
                const pCScoaseRaw = pOvr.cosuriScoase !== undefined ? pOvr.cosuriScoase : (cosuriScoase > 0 ? cosuriScoase : '');
                const pCScoase = pCScoaseRaw === '' ? '' : parseMoney(pCScoaseRaw);
                const pCScoaseNote = getLegacyTextNote(pCScoaseRaw);
                const pCustomVals = customColValues[person.name] || {};
                const pExtraAmount = parseStrictMoney(pExtraText);
                const pRowTotal = computeRowTotal(
                  [Number(pCost) || 0, pPersonalCost, pDedicationCost, pSonetCost, pExtraAmount, pPretExtra, pGreseli, parseMoney(pFSep), parseMoney(pCScoase)],
                  customColumns,
                  pCustomVals
                );

                return (
                  <tr key={person.id} style={{ height: '32px', color: '#000000' }}>
                    <td style={{ border: '1px solid #B0C4DE', padding: '4px', textAlign: 'center', backgroundColor: '#E6ECF5', fontWeight: 700 }}>
                      {classData.studentList.length + 2 + pIdx}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px 6px', backgroundColor: '#D9E1F2', fontWeight: 600 }}>
                      {isAdmin ? (
                        <input
                          type="text"
                          value={pName}
                          onChange={(e) => updateStudentCell(person.name, 'name', e.target.value)}
                          style={{ width: '95%', border: '1px dashed #718096', padding: '3px 6px', borderRadius: '3px', fontSize: '12px', fontWeight: 600, backgroundColor: '#FFFFFF' }}
                        />
                      ) : pName}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={pCost}
                          onChange={(e) => updateStudentCell(person.name, 'albumCost', parseInt(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : pCost}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={pPersonalCost}
                          onChange={(e) => updateStudentCell(person.name, 'personalCost', parseInt(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : pPersonalCost}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={pDedicationCost}
                          onChange={(e) => updateStudentCell(person.name, 'dedicationCost', parseInt(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : pDedicationCost}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={pSonetCost}
                          onChange={(e) => updateStudentCell(person.name, 'sonetCost', parseInt(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : pSonetCost}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px 6px', backgroundColor: '#FCE4D6' }}>
                      {isAdmin ? (
                        <input
                          type="text"
                          value={pExtraText}
                          onChange={(e) => updateStudentCell(person.name, 'extraText', e.target.value)}
                          style={{ width: '95%', border: '1px dashed #718096', padding: '3px 6px', borderRadius: '3px', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : pExtraText}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={pPretExtra}
                          onChange={(e) => updateStudentCell(person.name, 'pretExtra', parseFloat(e.target.value) || 0)}
                          style={{ width: '85%', border: '1px solid #3182CE', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', fontWeight: 700, backgroundColor: '#FFFFFF' }}
                        />
                      ) : pPretExtra}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={pGreseli}
                          title={pGreseliNote || undefined}
                          onChange={(e) => updateStudentCell(person.name, 'greseli', parseFloat(e.target.value) || 0)}
                          style={{ width: '85%', border: pGreseliNote ? '1px solid #DD6B20' : '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (<span title={pGreseliNote || undefined}>{pGreseli}</span>)}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={pFSep}
                          title={pFSepNote || undefined}
                          onChange={(e) => updateStudentCell(person.name, 'folderSeparat', parseFloat(e.target.value) || 0)}
                          style={{ width: '85%', border: pFSepNote ? '1px solid #DD6B20' : '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (<span title={pFSepNote || undefined}>{pFSep}</span>)}
                    </td>

                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          value={pCScoase}
                          title={pCScoaseNote || undefined}
                          onChange={(e) => updateStudentCell(person.name, 'cosuriScoase', parseFloat(e.target.value) || 0)}
                          style={{ width: '85%', border: pCScoaseNote ? '1px solid #DD6B20' : '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                        />
                      ) : (<span title={pCScoaseNote || undefined}>{pCScoase}</span>)}
                    </td>

                    {customColumns.map((col) => {
                      const isMoneyCol = col.moneyType === 'lei';
                      const rawVal = pCustomVals[col.id];
                      const curVal = isMoneyCol ? parseMoney(rawVal) : (rawVal ?? '0');
                      return (
                        <td key={col.id} style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                          {isAdmin ? (
                            <input
                              type={isMoneyCol ? 'number' : 'text'}
                              value={curVal}
                              onChange={(e) => updateCustomColumnValue(person.name, col.id, isMoneyCol ? (parseFloat(e.target.value) || 0) : e.target.value)}
                              style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                            />
                          ) : curVal}
                        </td>
                      );
                    })}

                    {/* TOTAL (calculat, needitabil) */}
                    <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'right', backgroundColor: '#FFF2CC', fontWeight: 700 }}>
                      {pRowTotal} LEI
                    </td>

                    {isAdmin && <td className="no-print" style={{ border: '1px solid #B0C4DE', textAlign: 'center' }}>-</td>}
                  </tr>
                );
              })}

              {/* Custom Admin Added Rows */}
              {customRows.map((cRow, cIdx) => {
                const cGreseliRaw = cRow.greseli;
                const cGreseli = parseMoney(cGreseliRaw);
                const cGreseliNote = getLegacyTextNote(cGreseliRaw);
                const cFSepRaw = cRow.folderSeparat;
                const cFSep = parseMoney(cFSepRaw);
                const cFSepNote = getLegacyTextNote(cFSepRaw);
                const cCScoaseRaw = cRow.cosuriScoase;
                const cCScoase = parseMoney(cCScoaseRaw);
                const cCScoaseNote = getLegacyTextNote(cCScoaseRaw);
                const cPretExtra = parseMoney(cRow.pretExtra);
                const cExtraAmount = parseStrictMoney(cRow.extraText);
                const cRowTotal = computeRowTotal(
                  [Number(cRow.albumCost) || 0, Number(cRow.personalCost) || 0, Number(cRow.dedicationCost) || 0, Number(cRow.sonetCost) || 0, cExtraAmount, cPretExtra, cGreseli, cFSep, cCScoase],
                  customColumns,
                  cRow.customColValues
                );

                return (
                <tr key={cRow.id} style={{ height: '32px', color: '#000000' }}>
                  <td style={{ border: '1px solid #B0C4DE', padding: '4px', textAlign: 'center', backgroundColor: '#E6ECF5', fontWeight: 700 }}>
                    {classData.studentList.length + 2 + (classData.specialPersons || []).length + cIdx}
                  </td>
                  <td style={{ border: '1px solid #B0C4DE', padding: '2px 6px', backgroundColor: '#D9E1F2' }}>
                    {isAdmin ? (
                      <input
                        type="text"
                        value={cRow.name}
                        onChange={(e) => updateCustomRowField(cRow.id, 'name', e.target.value)}
                        style={{ width: '95%', border: '1px solid #3182CE', padding: '3px 6px', borderRadius: '3px', fontSize: '12px', fontWeight: 600, backgroundColor: '#FFFFFF' }}
                      />
                    ) : (
                      cRow.name
                    )}
                  </td>
                  <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                    {isAdmin ? (
                      <input
                        type="number"
                        value={cRow.albumCost}
                        onChange={(e) => updateCustomRowField(cRow.id, 'albumCost', parseInt(e.target.value) || 0)}
                        style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                      />
                    ) : (
                      cRow.albumCost
                    )}
                  </td>
                  <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                    {isAdmin ? (
                      <input
                        type="number"
                        value={cRow.personalCost}
                        onChange={(e) => updateCustomRowField(cRow.id, 'personalCost', parseInt(e.target.value) || 0)}
                        style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                      />
                    ) : (
                      cRow.personalCost
                    )}
                  </td>
                  <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                    {isAdmin ? (
                      <input
                        type="number"
                        value={cRow.dedicationCost}
                        onChange={(e) => updateCustomRowField(cRow.id, 'dedicationCost', parseInt(e.target.value) || 0)}
                        style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                      />
                    ) : (
                      cRow.dedicationCost
                    )}
                  </td>
                  <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                    {isAdmin ? (
                      <input
                        type="number"
                        value={cRow.sonetCost}
                        onChange={(e) => updateCustomRowField(cRow.id, 'sonetCost', parseInt(e.target.value) || 0)}
                        style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                      />
                    ) : (
                      cRow.sonetCost
                    )}
                  </td>
                  <td style={{ border: '1px solid #B0C4DE', padding: '2px 6px', backgroundColor: '#FCE4D6' }}>
                    {isAdmin ? (
                      <input
                        type="text"
                        value={cRow.extraText}
                        onChange={(e) => updateCustomRowField(cRow.id, 'extraText', e.target.value)}
                        style={{ width: '95%', border: '1px dashed #718096', padding: '3px 6px', borderRadius: '3px', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                      />
                    ) : (
                      cRow.extraText
                    )}
                  </td>
                  <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                    {isAdmin ? (
                      <input
                        type="number"
                        value={cPretExtra}
                        onChange={(e) => updateCustomRowField(cRow.id, 'pretExtra', parseFloat(e.target.value) || 0)}
                        style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                      />
                    ) : (
                      cPretExtra
                    )}
                  </td>
                  <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                    {isAdmin ? (
                      <input
                        type="number"
                        value={cGreseli}
                        title={cGreseliNote || undefined}
                        onChange={(e) => updateCustomRowField(cRow.id, 'greseli', parseFloat(e.target.value) || 0)}
                        style={{ width: '85%', border: cGreseliNote ? '1px solid #DD6B20' : '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                      />
                    ) : (
                      <span title={cGreseliNote || undefined}>{cGreseli}</span>
                    )}
                  </td>
                  <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                    {isAdmin ? (
                      <input
                        type="number"
                        value={cFSep}
                        title={cFSepNote || undefined}
                        onChange={(e) => updateCustomRowField(cRow.id, 'folderSeparat', parseFloat(e.target.value) || 0)}
                        style={{ width: '85%', border: cFSepNote ? '1px solid #DD6B20' : '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                      />
                    ) : (
                      <span title={cFSepNote || undefined}>{cFSep}</span>
                    )}
                  </td>
                  <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                    {isAdmin ? (
                      <input
                        type="number"
                        value={cCScoase}
                        title={cCScoaseNote || undefined}
                        onChange={(e) => updateCustomRowField(cRow.id, 'cosuriScoase', parseFloat(e.target.value) || 0)}
                        style={{ width: '85%', border: cCScoaseNote ? '1px solid #DD6B20' : '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                      />
                    ) : (
                      <span title={cCScoaseNote || undefined}>{cCScoase}</span>
                    )}
                  </td>

                  {/* Dynamic Custom Columns for Custom Row */}
                  {customColumns.map((col) => {
                    const isMoneyCol = col.moneyType === 'lei';
                    const rawVal = cRow.customColValues?.[col.id];
                    const cVal = isMoneyCol ? parseMoney(rawVal) : (rawVal ?? '0');
                    return (
                      <td key={col.id} style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'center', backgroundColor: '#D9E1F2' }}>
                        {isAdmin ? (
                          <input
                            type={isMoneyCol ? 'number' : 'text'}
                            value={cVal}
                            onChange={(e) => updateCustomRowColValue(cRow.id, col.id, isMoneyCol ? (parseFloat(e.target.value) || 0) : e.target.value)}
                            style={{ width: '85%', border: '1px dashed #718096', padding: '3px', borderRadius: '3px', textAlign: 'center', fontSize: '12px', backgroundColor: '#FFFFFF' }}
                          />
                        ) : cVal}
                      </td>
                    );
                  })}

                  {/* TOTAL (calculat, needitabil) */}
                  <td style={{ border: '1px solid #B0C4DE', padding: '2px', textAlign: 'right', backgroundColor: '#FFF2CC', fontWeight: 700 }}>
                    {cRowTotal} LEI
                  </td>

                  {isAdmin && (
                    <td className="no-print" style={{ border: '1px solid #B0C4DE', textAlign: 'center' }}>
                      <button onClick={() => handleRemoveCustomRow(cRow.id)} style={{ background: 'none', border: 'none', color: '#E53E3E', cursor: 'pointer', padding: '2px' }} title="Șterge rând">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
                );
              })}

              {/* Spacing rows */}
              <tr style={{ height: '20px' }}><td colSpan={12 + customColumns.length + (isAdmin ? 1 : 0)}></td></tr>

              {/* Plăți Extra Row */}
              <tr style={{ height: '40px' }}>
                <td colSpan={6}></td>
                <td colSpan={4 + customColumns.length} style={{ padding: '8px', textAlign: 'right', color: '#000000', fontWeight: 700, fontSize: '11px' }}>
                  PLĂȚI EXTRA (TRANSPORT / ÎNTÂRZIERE):
                </td>
                <td style={{ padding: '4px', textAlign: 'center', backgroundColor: '#F0F0F0', color: '#000000', fontWeight: 700, border: '1px solid #000' }}>
                  {isAdmin ? (
                    <input
                      type="number"
                      value={extraClassPay}
                      onChange={(e) => updateExtraClassPay(parseInt(e.target.value) || 0)}
                      style={{ width: '90%', border: '1px solid #3182CE', padding: '4px', borderRadius: '4px', textAlign: 'center', fontSize: '12px', fontWeight: 700, backgroundColor: '#FFFFFF', color: '#000000' }}
                    />
                  ) : (
                    extraClassPay
                  )}
                </td>
                <td style={{ border: '1px solid #000' }}></td>
                {isAdmin && <td className="no-print"></td>}
              </tr>

              {/* Grand Total Row: sum of every row's own TOTAL (same shared
                  computeRowTotal helper used per-row above) plus PLĂȚI EXTRA. */}
              <tr style={{ height: '40px' }}>
                <td colSpan={10 + customColumns.length}></td>
                <td style={{ padding: '8px', textAlign: 'right', color: '#CC0000', fontWeight: 700, fontSize: '11px' }}>
                  TOTAL GENERAL (LEI):
                </td>
                <td style={{ padding: '8px', textAlign: 'center', backgroundColor: '#FFD700', color: '#000000', fontWeight: 800, fontSize: '15px', border: '2px solid #000' }}>
                  {(() => {
                    let sum = 0;

                    classData.studentList.forEach((st) => {
                      const sub = submissions[`${classData.id}_${st}`];
                      const ovr = overrides[st] || {};

                      let autoAlb = 0;
                      if (sub) autoAlb = sub.selectedAlbumType === 'mic' ? priceMic : priceMare;
                      const stAlbum = ovr.albumCost !== undefined ? ovr.albumCost : autoAlb;

                      const autoPers = (sub?.extraPersonalPagesCount || 0) * pricePages;
                      const stPersonal = ovr.personalCost !== undefined ? ovr.personalCost : autoPers;

                      const autoDed = (sub?.extraDedicationPagesCount || 0) * pricePages;
                      const stDedication = ovr.dedicationCost !== undefined ? ovr.dedicationCost : autoDed;

                      let autoSon = 0;
                      if (isSoneteEnabled && (sub?.wantsSonetPhoto || sub?.wantsSonetCitat || sub?.sonetPhoto)) autoSon = priceSonet;
                      const stSonet = ovr.sonetCost !== undefined ? ovr.sonetCost : autoSon;

                      let stAutoExtraText = '0';
                      if (sub?.extraItemsText && sub.extraItemsText.trim().length > 0) {
                        stAutoExtraText = sub.extraItemsText.trim();
                      } else if (sub?.wantsExtraItems) {
                        stAutoExtraText = 'Da';
                      }
                      const stExtraText = ovr.extraText !== undefined ? ovr.extraText : stAutoExtraText;
                      const stExtraAmount = parseStrictMoney(stExtraText);

                      const stPretExtra = parseMoney(ovr.pretExtra !== undefined ? ovr.pretExtra : (classData.studentPretExtraMap?.[st] || 0));
                      const stGreseli = parseMoney(ovr.greseli !== undefined ? ovr.greseli : (classData.studentGreseliMap?.[st] || ''));
                      const stFSep = parseMoney(ovr.folderSeparat !== undefined ? ovr.folderSeparat : (folderSeparat > 0 ? folderSeparat : ''));
                      const stCScoase = parseMoney(ovr.cosuriScoase !== undefined ? ovr.cosuriScoase : (cosuriScoase > 0 ? cosuriScoase : ''));

                      sum += computeRowTotal(
                        [stAlbum, stPersonal, stDedication, stSonet, stExtraAmount, stPretExtra, stGreseli, stFSep, stCScoase],
                        customColumns,
                        customColValues[st]
                      );
                    });

                    // Diriginte row
                    const dirOvr = overrides['!DIRIGINTE'] || {};
                    const dirExtraTextGT = dirOvr.extraText ?? '0';
                    const dirExtraAmountGT = parseStrictMoney(dirExtraTextGT);
                    sum += computeRowTotal(
                      [
                        dirOvr.albumCost ?? 0,
                        dirOvr.personalCost ?? 0,
                        dirOvr.dedicationCost ?? 0,
                        dirOvr.sonetCost ?? 0,
                        dirExtraAmountGT,
                        parseMoney(dirOvr.pretExtra ?? 0),
                        parseMoney(dirOvr.greseli ?? ''),
                        parseMoney(dirOvr.folderSeparat ?? (folderSeparat > 0 ? folderSeparat : '')),
                        parseMoney(dirOvr.cosuriScoase ?? (cosuriScoase > 0 ? cosuriScoase : ''))
                      ],
                      customColumns,
                      customColValues['!DIRIGINTE']
                    );

                    (classData.specialPersons || []).forEach((sp) => {
                      const pOvr = overrides[sp.name] || {};
                      const pCost = pOvr.albumCost !== undefined ? pOvr.albumCost : (Number(sp.albumPrice) || 0);
                      const pExtraTextGT = pOvr.extraText ?? '0';
                      const pExtraAmountGT = parseStrictMoney(pExtraTextGT);
                      sum += computeRowTotal(
                        [
                          pCost,
                          pOvr.personalCost ?? 0,
                          pOvr.dedicationCost ?? 0,
                          pOvr.sonetCost ?? 0,
                          pExtraAmountGT,
                          parseMoney(pOvr.pretExtra ?? 0),
                          parseMoney(pOvr.greseli ?? ''),
                          parseMoney(pOvr.folderSeparat !== undefined ? pOvr.folderSeparat : (folderSeparat > 0 ? folderSeparat : '')),
                          parseMoney(pOvr.cosuriScoase !== undefined ? pOvr.cosuriScoase : (cosuriScoase > 0 ? cosuriScoase : ''))
                        ],
                        customColumns,
                        customColValues[sp.name]
                      );
                    });

                    customRows.forEach((cRow) => {
                      const cExtraAmountGT = parseStrictMoney(cRow.extraText);
                      sum += computeRowTotal(
                        [
                          Number(cRow.albumCost) || 0,
                          Number(cRow.personalCost) || 0,
                          Number(cRow.dedicationCost) || 0,
                          Number(cRow.sonetCost) || 0,
                          cExtraAmountGT,
                          parseMoney(cRow.pretExtra),
                          parseMoney(cRow.greseli),
                          parseMoney(cRow.folderSeparat),
                          parseMoney(cRow.cosuriScoase)
                        ],
                        customColumns,
                        cRow.customColValues
                      );
                    });

                    return sum + extraClassPay;
                  })()} LEI
                </td>
                {isAdmin && <td className="no-print"></td>}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Adăugare Coloană Nouă */}
      {newColModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ backgroundColor: '#FFFFFF', padding: '24px', borderRadius: '8px', width: '90%', maxWidth: '400px', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#091E42' }}>Adaugă Coloană Nouă în Tabel</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#5E6C84' }}>Exemple: TABLOU 30X40, DISCOUNT, OBSERVAȚII TEHNICE etc.</p>
            
            <input
              type="text"
              placeholder="Nume Coloană (ex: TABLOU 30X40)"
              value={newColTitle}
              onChange={(e) => setNewColTitle(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E0', borderRadius: '4px', fontSize: '13px', marginBottom: '16px' }}
              autoFocus
            />

            <div style={{ marginBottom: '20px' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 600, color: '#091E42' }}>Tip coloană:</p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', marginBottom: '6px', cursor: 'pointer' }}>
                <input type="radio" name="newColType" checked={newColMoneyType === 'info'} onChange={() => setNewColMoneyType('info')} />
                Informativ (text)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="radio" name="newColType" checked={newColMoneyType === 'lei'} onChange={() => setNewColMoneyType('lei')} />
                Bani (lei) — se adună în TOTAL
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => { setNewColModal(false); setNewColMoneyType('info'); }} style={{ padding: '8px 16px', backgroundColor: '#EDF2F7', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>Renunță</button>
              <button onClick={handleAddCustomColumn} style={{ padding: '8px 18px', backgroundColor: '#D97706', color: '#FFF', border: 'none', borderRadius: '4px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>+ Adaugă Coloană</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background-color: #FFFFFF !important;
            padding: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}
