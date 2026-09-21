import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection, query, where, orderBy, getDocs, documentId, Timestamp, writeBatch, limit,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { dayKey, type VisitKind } from '../../utils/visitTracker';
import { RefreshCw } from 'lucide-react';

/**
 * Admin "Statistici" tab: who is on the public site right now, and visits per
 * day / per page over the last 30 days. Data comes from src/utils/visitTracker.ts.
 *
 * Mounted only while the tab is open. Cost per open: ~30 small reads for the
 * history plus one presence query every 30 s while the tab stays open.
 */

interface Props {
  classNames: Record<string, string>;
  galleryNames: Record<string, string>;
}

interface PageKey { kind: VisitKind; refId: string }

const LIVE_WINDOW_MS = 150_000;   // seen in the last 2.5 min = "on the site now"
const POLL_MS = 30_000;
const DAYS = 30;

const KIND_LABEL: Record<VisitKind, string> = {
  gallery: 'Galerie foto',
  selection: 'Selecție poze',
  class_gallery: 'Galerie clasă',
  class_form: 'Configurator album',
  album: 'Album interactiv',
};

// Chart tokens — single series, so one hue (the panel's gold) and ink for text.
const INK = { primary: '#FAF9F6', secondary: '#A3A09B', muted: '#706E6A', grid: '#262423' };
const BAR = '#D4AF37';

const shortDate = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
const longDate = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' });

export const SiteStatsView: React.FC<Props> = ({ classNames, galleryNames }) => {
  const [live, setLive] = useState<PageKey[] | null>(null);
  const [days, setDays] = useState<{ day: string; count: number }[]>([]);
  const [top, setTop] = useState<(PageKey & { count: number })[]>([]);
  const [albumNames, setAlbumNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const nameOf = (p: PageKey) => {
    if (p.kind === 'gallery' || p.kind === 'selection') return galleryNames[p.refId] || 'Galerie ștearsă';
    if (p.kind === 'class_gallery' || p.kind === 'class_form') return classNames[p.refId] || 'Clasă ștearsă';
    return albumNames[p.refId] || 'Album interactiv';
  };

  const loadLive = useCallback(async () => {
    try {
      const snap = await getDocs(query(
        collection(db, 'presence'),
        where('lastSeen', '>=', Timestamp.fromMillis(Date.now() - LIVE_WINDOW_MS)),
        limit(500)
      ));
      setLive(snap.docs.map(d => ({ kind: d.get('kind'), refId: d.get('refId') })));
    } catch (e) {
      console.error('[Stats] live query failed:', e);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const keys = Array.from({ length: DAYS }, (_, i) =>
        dayKey(new Date(Date.now() - (DAYS - 1 - i) * 86_400_000))
      );
      const snap = await getDocs(query(
        collection(db, 'stats_daily'),
        where(documentId(), '>=', keys[0]),
        orderBy(documentId())
      ));
      const byDay: Record<string, number> = {};
      snap.docs.forEach(d => { byDay[d.id] = d.get('count') || 0; });
      setDays(keys.map(k => ({ day: k, count: byDay[k] || 0 })));

      // Per-page totals over the window: one small subcollection per active day.
      const itemSnaps = await Promise.all(snap.docs.map(d => getDocs(collection(d.ref, 'items'))));
      const agg: Record<string, PageKey & { count: number }> = {};
      itemSnaps.forEach(s => s.docs.forEach(d => {
        const kind = d.get('kind') as VisitKind;
        const refId = d.get('refId') as string;
        const k = `${kind}_${refId}`;
        agg[k] = agg[k] || { kind, refId, count: 0 };
        agg[k].count += d.get('count') || 0;
      }));
      const list = Object.values(agg).sort((a, b) => b.count - a.count);
      setTop(list);

      // Interactive albums are named only if any were visited.
      if (list.some(p => p.kind === 'album')) {
        const fb = await getDocs(collection(db, 'flipbooks'));
        setAlbumNames(Object.fromEntries(fb.docs.map(d => [d.id, d.get('title') || 'Album interactiv'])));
      }
    } catch (e) {
      console.error('[Stats] history failed:', e);
      setError('Nu am putut încărca statisticile. Reîncearcă.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
    loadLive();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') loadLive();
    }, POLL_MS);

    // Housekeeping: drop presence rows older than a day so the collection stays tiny.
    (async () => {
      try {
        const old = await getDocs(query(
          collection(db, 'presence'),
          where('lastSeen', '<', Timestamp.fromMillis(Date.now() - 86_400_000)),
          limit(400)
        ));
        if (old.empty) return;
        const batch = writeBatch(db);
        old.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      } catch { /* best effort */ }
    })();

    return () => clearInterval(t);
  }, [loadHistory, loadLive]);

  const liveGroups = useMemo(() => {
    const g: Record<string, PageKey & { count: number }> = {};
    (live || []).forEach(p => {
      const k = `${p.kind}_${p.refId}`;
      g[k] = g[k] || { ...p, count: 0 };
      g[k].count++;
    });
    return Object.values(g).sort((a, b) => b.count - a.count);
  }, [live]);

  const today = days[days.length - 1]?.count ?? 0;
  const last7 = days.slice(-7).reduce((s, d) => s + d.count, 0);
  const last30 = days.reduce((s, d) => s + d.count, 0);

  // ── Chart geometry ──
  const W = 640, H = 200, padL = 34, padR = 8, padT = 12, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const rawMax = Math.max(1, ...days.map(d => d.count));
  const step = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceMax = Math.ceil(rawMax / step) * step;
  const slot = plotW / Math.max(1, days.length);
  const barW = Math.max(1, slot - 2); // 2px surface gap between bars

  const barPath = (x: number, y: number, w: number, h: number) => {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
  };

  const tile = (label: string, value: React.ReactNode, hint?: string) => (
    <div style={{ flex: '1 1 150px', backgroundColor: '#161514', border: '1px solid #2D2A28', borderRadius: '8px', padding: '16px 18px' }}>
      <div style={{ fontSize: '11px', color: INK.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '30px', color: INK.primary, fontWeight: 600, marginTop: '6px', lineHeight: 1.1 }}>{value}</div>
      {hint && <div style={{ fontSize: '11px', color: INK.muted, marginTop: '4px' }}>{hint}</div>}
    </div>
  );

  return (
    <div className="dashboard-section animate-fade">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', color: INK.primary, fontWeight: 600 }}>Statistici vizite</h2>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: INK.muted }}>
            Galerii, selecții, albume de clasă și albume interactive. Vizitele tale, când ești logat, nu sunt numărate.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => { loadHistory(); loadLive(); }}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> Reîmprospătează
        </button>
      </div>

      {error && <p style={{ color: '#E06C75', fontSize: '13px' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {tile(
          'Pe site acum',
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
            <span className="live-dot" aria-hidden="true" />
            {live === null ? '…' : live.length}
          </span>,
          'se actualizează la 30 s'
        )}
        {tile('Azi', loading ? '…' : today.toLocaleString('ro-RO'))}
        {tile('Ultimele 7 zile', loading ? '…' : last7.toLocaleString('ro-RO'))}
        {tile('Ultimele 30 de zile', loading ? '…' : last30.toLocaleString('ro-RO'))}
      </div>

      {liveGroups.length > 0 && (
        <div style={{ backgroundColor: '#161514', border: '1px solid #2D2A28', borderRadius: '8px', padding: '14px 18px', marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', color: INK.secondary, fontWeight: 600, marginBottom: '8px' }}>Ce se vede acum</div>
          {liveGroups.map(p => (
            <div key={`${p.kind}_${p.refId}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', borderTop: '1px solid #1C1A19', fontSize: '13px' }}>
              <span style={{ color: INK.primary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nameOf(p)} <span style={{ color: INK.muted, fontSize: '11px' }}>· {KIND_LABEL[p.kind] || p.kind}</span>
              </span>
              <span style={{ color: INK.secondary, flexShrink: 0 }}>{p.count} {p.count === 1 ? 'vizitator' : 'vizitatori'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Daily visits — one series, so the title names it and no legend is needed */}
      <div style={{ backgroundColor: '#161514', border: '1px solid #2D2A28', borderRadius: '8px', padding: '16px 18px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '10px' }}>
          <div style={{ fontSize: '13px', color: INK.primary, fontWeight: 600 }}>Vizite pe zi — ultimele 30 de zile</div>
          <button
            type="button"
            onClick={() => setShowTable(v => !v)}
            style={{ background: 'none', border: 'none', color: INK.secondary, fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {showTable ? 'Vezi graficul' : 'Vezi ca tabel'}
          </button>
        </div>

        {showTable ? (
          <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <tbody>
                {[...days].reverse().map(d => (
                  <tr key={d.day} style={{ borderBottom: '1px solid #1C1A19' }}>
                    <td style={{ padding: '7px 4px', color: INK.secondary }}>{longDate(d.day)}</td>
                    <td style={{ padding: '7px 4px', color: INK.primary, textAlign: 'right' }}>{d.count.toLocaleString('ro-RO')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ position: 'relative' }} onMouseLeave={() => setHoverIdx(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Vizite pe zi în ultimele 30 de zile">
              {[0, 0.5, 1].map(f => {
                const y = padT + plotH - f * plotH;
                return (
                  <g key={f}>
                    <line x1={padL} x2={W - padR} y1={y} y2={y} stroke={INK.grid} strokeWidth={1} />
                    <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill={INK.muted}>
                      {Math.round(niceMax * f).toLocaleString('ro-RO')}
                    </text>
                  </g>
                );
              })}
              {days.map((d, i) => {
                const h = (d.count / niceMax) * plotH;
                const x = padL + i * slot + 1;
                const y = padT + plotH - h;
                return (
                  <g key={d.day}>
                    {h > 0 && (
                      <path d={barPath(x, y, barW, h)} fill={BAR} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.45} />
                    )}
                    {/* Hit target: the whole column, larger than the mark */}
                    <rect
                      x={padL + i * slot} y={padT} width={slot} height={plotH}
                      fill="transparent"
                      onMouseEnter={() => setHoverIdx(i)}
                      onTouchStart={() => setHoverIdx(i)}
                    />
                    {/* Weekly ticks counted back from today, so today is always
                        labelled and never collides with a neighbouring tick.
                        Today's label is right-aligned to stay inside the plot. */}
                    {(days.length - 1 - i) % 7 === 0 && (
                      <text
                        x={i === days.length - 1 ? x + barW : x + barW / 2}
                        y={H - 8}
                        textAnchor={i === days.length - 1 ? 'end' : 'middle'}
                        fontSize="10"
                        fill={INK.muted}
                      >
                        {shortDate(d.day)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {hoverIdx !== null && days[hoverIdx] && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: `${((padL + hoverIdx * slot + slot / 2) / W) * 100}%`,
                  transform: `translateX(${hoverIdx > days.length * 0.7 ? '-100%' : hoverIdx < days.length * 0.3 ? '0' : '-50%'})`,
                  backgroundColor: '#0E0D0C',
                  border: '1px solid #3D3834',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                  fontSize: '12px',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
                }}
              >
                <div style={{ color: INK.secondary }}>{longDate(days[hoverIdx].day)}</div>
                <div style={{ color: INK.primary, fontWeight: 600 }}>
                  {days[hoverIdx].count.toLocaleString('ro-RO')} {days[hoverIdx].count === 1 ? 'vizită' : 'vizite'}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && last30 === 0 && (
          <p style={{ margin: '10px 0 0', fontSize: '12px', color: INK.muted }}>
            Încă nu sunt vizite înregistrate. Contorul numără de la activarea lui încolo — nu există date din urmă.
          </p>
        )}
      </div>

      {/* Per-page totals */}
      <div style={{ backgroundColor: '#161514', border: '1px solid #2D2A28', borderRadius: '8px', padding: '16px 18px' }}>
        <div style={{ fontSize: '13px', color: INK.primary, fontWeight: 600, marginBottom: '10px' }}>Cele mai vizitate — ultimele 30 de zile</div>
        {top.length === 0 ? (
          <p style={{ margin: 0, fontSize: '12px', color: INK.muted }}>{loading ? 'Se încarcă…' : 'Nicio vizită încă.'}</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <tbody>
              {top.slice(0, 25).map(p => (
                <tr key={`${p.kind}_${p.refId}`} style={{ borderBottom: '1px solid #1C1A19' }}>
                  <td style={{ padding: '8px 4px', color: INK.primary }}>
                    {nameOf(p)}
                    <div style={{ fontSize: '11px', color: INK.muted }}>{KIND_LABEL[p.kind] || p.kind}</div>
                  </td>
                  <td style={{ padding: '8px 4px', color: INK.primary, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {p.count.toLocaleString('ro-RO')} {p.count === 1 ? 'vizită' : 'vizite'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        .live-dot {
          width: 10px; height: 10px; border-radius: 50%;
          background: #2ECC71;
          box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.6);
          animation: livePulse 2s infinite;
        }
        @keyframes livePulse {
          0% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.6); }
          70% { box-shadow: 0 0 0 10px rgba(46, 204, 113, 0); }
          100% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0); }
        }
      `}</style>
    </div>
  );
};
