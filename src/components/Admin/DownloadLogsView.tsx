import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection, query, orderBy, limit, startAfter, getDocs, getCountFromServer,
  type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Search, Download, RefreshCw, FileText } from 'lucide-react';

/**
 * Every download ever logged, across all galleries and class albums, newest first.
 *
 * Deliberately NOT a live listener and NOT loaded with the dashboard: the log
 * grows every day (7k+ entries already), and pulling it on every panel open is
 * exactly what used to slow the admin down. This view reads nothing until it
 * is opened, then pages in 50 at a time.
 */

interface LogRow {
  id: string;
  email?: string;
  filesList?: string[];
  downloadedAt?: { toDate?: () => Date };
  classId?: string;
  galleryId?: string;
  galleryTitle?: string;
}

interface DownloadLogsViewProps {
  classNames: Record<string, string>;    // classId -> school name
  galleryNames: Record<string, string>;  // galleryId -> title
}

const PAGE_SIZE = 50;

export const DownloadLogsView: React.FC<DownloadLogsViewProps> = ({ classNames, galleryNames }) => {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'gallery' | 'class'>('all');

  const loadPage = useCallback(async (after: QueryDocumentSnapshot<DocumentData> | null, pageSize: number | null) => {
    setLoading(true);
    setError('');
    try {
      const parts = [orderBy('downloadedAt', 'desc')] as any[];
      if (after) parts.push(startAfter(after));
      if (pageSize) parts.push(limit(pageSize));
      const snap = await getDocs(query(collection(db, 'downloads'), ...parts));
      const next = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<LogRow, 'id'>) }));
      setRows(prev => (after ? [...prev, ...next] : next));
      setCursor(snap.docs[snap.docs.length - 1] ?? after);
      setHasMore(pageSize !== null && snap.docs.length === pageSize);
    } catch (e: any) {
      console.error('[DownloadLogs] load failed:', e);
      setError('Nu am putut încărca jurnalul. Reîncearcă.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPage(null, PAGE_SIZE);
    // A count is a single cheap read, not a download of every log.
    getCountFromServer(collection(db, 'downloads'))
      .then(s => setTotal(s.data().count))
      .catch(() => setTotal(null));
  }, [loadPage]);

  const sourceOf = (r: LogRow) => {
    if (r.galleryId) return { kind: 'gallery' as const, label: r.galleryTitle || galleryNames[r.galleryId] || 'Galerie ștearsă' };
    if (r.classId) return { kind: 'class' as const, label: classNames[r.classId] || 'Clasă ștearsă' };
    return { kind: 'gallery' as const, label: '—' };
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      const src = sourceOf(r);
      if (typeFilter !== 'all' && src.kind !== typeFilter) return false;
      if (!q) return true;
      return (
        r.email?.toLowerCase().includes(q) ||
        src.label.toLowerCase().includes(q) ||
        r.filesList?.some(f => f.toLowerCase().includes(q))
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, typeFilter, classNames, galleryNames]);

  const allLoaded = !hasMore;
  const cell: React.CSSProperties = { padding: '10px 8px', verticalAlign: 'top' };

  return (
    <div className="dashboard-section animate-fade">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', color: '#FAF9F6', fontWeight: 600 }}>Jurnal descărcări</h2>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#706E6A' }}>
            Toate descărcările, din toate galeriile și albumele, de la cele mai noi.
            {total !== null && <> Afișate <strong style={{ color: '#A3A09B' }}>{rows.length.toLocaleString('ro-RO')}</strong> din <strong style={{ color: '#A3A09B' }}>{total.toLocaleString('ro-RO')}</strong>.</>}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => { setRows([]); setCursor(null); setHasMore(true); loadPage(null, PAGE_SIZE); }}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> Reîmprospătează
        </button>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <div style={{ flex: '1 1 260px', display: 'flex', alignItems: 'center', padding: '8px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', borderRadius: '4px' }}>
          <Search size={16} style={{ color: '#706E6A', marginRight: '8px', flexShrink: 0 }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Caută după email, galerie/clasă sau fișier..."
            style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', color: '#FAF9F6', outline: 'none', fontSize: '13px' }}
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}
          style={{ padding: '8px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', borderRadius: '4px', color: '#FAF9F6', fontSize: '13px' }}
        >
          <option value="all">Toate sursele</option>
          <option value="gallery">Doar galerii foto</option>
          <option value="class">Doar albume absolvenți</option>
        </select>
      </div>

      {search && !allLoaded && (
        <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#A3A09B' }}>
          Căutarea se face în cele {rows.length.toLocaleString('ro-RO')} log-uri încărcate. Pentru a căuta în tot jurnalul, apasă „Încarcă tot” de jos.
        </p>
      )}

      {error && <p style={{ color: '#E06C75', fontSize: '13px' }}>{error}</p>}

      <div style={{ overflowX: 'auto', border: '1px solid #262423', borderRadius: '6px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '720px' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #262423', backgroundColor: '#12110F' }}>
              <th style={{ ...cell, color: '#706E6A', fontWeight: 600 }}>Dată</th>
              <th style={{ ...cell, color: '#706E6A', fontWeight: 600 }}>Email</th>
              <th style={{ ...cell, color: '#706E6A', fontWeight: 600 }}>Sursă</th>
              <th style={{ ...cell, color: '#706E6A', fontWeight: 600 }}>Tip</th>
              <th style={{ ...cell, color: '#706E6A', fontWeight: 600 }}>Fișiere</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const src = sourceOf(r);
              const date = r.downloadedAt?.toDate ? r.downloadedAt.toDate().toLocaleString('ro-RO') : '—';
              const isZip = r.filesList?.some(f => f.includes('ZIP') || f.includes('Arhivă'));
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #1C1A19' }}>
                  <td style={{ ...cell, color: '#A3A09B', whiteSpace: 'nowrap' }}>{date}</td>
                  <td style={{ ...cell, color: '#FAF9F6', fontWeight: 500, wordBreak: 'break-all' }}>{r.email || '—'}</td>
                  <td style={cell}>
                    <div style={{ color: '#E5DFD9' }}>{src.label}</div>
                    <div style={{ fontSize: '11px', color: '#706E6A' }}>{src.kind === 'class' ? 'Album absolvenți' : 'Galerie foto'}</div>
                  </td>
                  <td style={cell}>
                    <span style={{
                      fontSize: '10px', padding: '2px 6px', borderRadius: '3px', fontWeight: 600, whiteSpace: 'nowrap',
                      backgroundColor: isZip ? 'rgba(212, 175, 55, 0.15)' : 'rgba(112, 110, 106, 0.15)',
                      color: isZip ? 'var(--gold-accent)' : '#FAF9F6',
                    }}>
                      {isZip ? 'ZIP' : 'Imagine'}
                    </span>
                  </td>
                  <td style={{ ...cell, color: '#A3A09B', maxWidth: '260px' }} title={r.filesList?.join(', ')}>
                    <Download size={12} style={{ marginRight: '6px', display: 'inline', verticalAlign: 'middle' }} />
                    {r.filesList?.length || 0} fișier(e)
                    <div style={{ fontSize: '11px', color: '#706E6A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.filesList?.slice(0, 3).join(', ')}{r.filesList && r.filesList.length > 3 ? '…' : ''}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#706E6A', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <FileText size={36} style={{ opacity: 0.5 }} />
            <span style={{ fontSize: '13px' }}>Niciun log găsit.</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
        {loading && <span style={{ color: '#A3A09B', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}><RefreshCw size={14} className="spinner" /> Se încarcă...</span>}
        {!loading && hasMore && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadPage(cursor, PAGE_SIZE)}>
              Încarcă încă {PAGE_SIZE}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => loadPage(cursor, null)}
              title="Aduce restul jurnalului dintr-o dată — util pentru căutare"
            >
              Încarcă tot{total !== null ? ` (${Math.max(0, total - rows.length).toLocaleString('ro-RO')} rămase)` : ''}
            </button>
          </>
        )}
        {!loading && allLoaded && rows.length > 0 && (
          <span style={{ color: '#706E6A', fontSize: '12px' }}>Ai ajuns la capătul jurnalului.</span>
        )}
      </div>
    </div>
  );
};
