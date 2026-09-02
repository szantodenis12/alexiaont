/**
 * Album studio entry point — the unlisted index of interactive albums.
 *
 * Reached only by typing /atelier-album. Nothing in the admin dashboard links
 * here by design; the client wanted this module kept off every other page.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { BookOpen, Copy, Check, ExternalLink, Plus, Trash2, X } from 'lucide-react';
import { blankCover, blankPage, makeShareToken } from './flipbookTypes';
import type { Flipbook } from './flipbookTypes';

interface SourceOption {
  id: string;
  name: string;
  type: 'gallery' | 'class' | 'upload';
}

/** Lets an album be built purely from photos uploaded into it. */
const UPLOAD_SOURCE: SourceOption = {
  id: '',
  name: 'Fara galerie - incarc eu pozele',
  type: 'upload',
};

export const FlipbookList: React.FC = () => {
  const navigate = useNavigate();
  const [books, setBooks] = useState<Flipbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSource, setNewSource] = useState<SourceOption | null>(UPLOAD_SOURCE);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadBooks = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'flipbooks'), orderBy('createdAt', 'desc')));
      setBooks(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Flipbook));
    } catch (e) {
      console.error('Failed to load albums:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBooks(); }, []);

  const loadSources = async () => {
    if (sources.length || sourcesLoading) return;
    setSourcesLoading(true);
    try {
      const [gSnap, cSnap] = await Promise.all([
        getDocs(collection(db, 'photo_galleries')),
        getDocs(collection(db, 'classes')),
      ]);
      const out: SourceOption[] = [
        UPLOAD_SOURCE,
        ...gSnap.docs.map(d => ({
          id: d.id,
          name: (d.data().title as string) || 'Galerie',
          type: 'gallery' as const,
        })),
        ...cSnap.docs.map(d => ({
          id: d.id,
          name: (d.data().className as string) || (d.data().name as string) || 'Clasa',
          type: 'class' as const,
        })),
      ];
      setSources(out);
    } catch (e) {
      console.error('Failed to load sources:', e);
    } finally {
      setSourcesLoading(false);
    }
  };

  const create = async () => {
    if (!newTitle.trim() || !newSource || busy) return;
    setBusy(true);
    try {
      const book: Omit<Flipbook, 'id'> = {
        title: newTitle.trim(),
        sourceType: newSource.type,
        sourceId: newSource.id,
        sourceName: newSource.type === 'upload' ? '' : newSource.name,
        shareToken: makeShareToken(),
        published: false,
        pageAspect: 'portrait',
        cover: blankCover(newTitle.trim(), newSource.type === 'upload' ? '' : newSource.name),
        backCover: blankCover('', ''),
        // One page to start, so the studio opens on something rather than nothing.
        pages: [blankPage('single')],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, 'flipbooks'), book);
      navigate(`/atelier-album/${ref.id}`);
    } catch (e) {
      // Surface the real cause: a permission error and a malformed-document
      // error need completely different fixes.
      const err = e as { code?: string; message?: string };
      console.error('Failed to create album:', err.code, err.message, e);
      alert(
        `Nu am putut crea albumul.

Cod: ${err.code || 'necunoscut'}
${err.message || ''}`
      );
      setBusy(false);
    }
  };

  const remove = async (b: Flipbook) => {
    if (!confirm(`Stergi albumul "${b.title}"? Linkul distribuit nu va mai functiona.`)) return;
    try {
      await deleteDoc(doc(db, 'flipbooks', b.id));
      setBooks(list => list.filter(x => x.id !== b.id));
    } catch (e) {
      console.error('Failed to delete album:', e);
    }
  };

  const copyLink = async (b: Flipbook) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/album/${b.shareToken}`);
      setCopiedId(b.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div style={S.shell}>
      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <BookOpen size={18} color="#D4AF37" />
          <div>
            <h1 style={S.h1}>Atelier Albume</h1>
            <p style={S.sub}>Albume interactive - modul privat</p>
          </div>
        </div>
        <button
          onClick={() => { setCreating(true); loadSources(); }}
          style={S.primaryBtn}
        >
          <Plus size={14} /> Album nou
        </button>
      </header>

      <main style={S.main}>
        {loading ? (
          <p style={S.muted}>Se incarca...</p>
        ) : books.length === 0 ? (
          <div style={S.empty}>
            <BookOpen size={30} color="#3A3633" />
            <p style={S.muted}>Niciun album creat inca.</p>
          </div>
        ) : (
          <div style={S.grid}>
            {books.map(b => (
              <div key={b.id} style={S.card}>
                <button onClick={() => navigate(`/atelier-album/${b.id}`)} style={S.cardTop}>
                  <div style={S.cardCover}>
                    {b.cover?.imageUrl ? (
                      <img src={b.cover.imageUrl} alt="" style={S.cardImg} />
                    ) : (
                      <BookOpen size={22} color="#3A3633" />
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={S.cardTitle}>{b.title}</div>
                    <div style={S.cardMeta}>
                      {b.pages?.length || 0} pagini
                      {b.sourceName ? ` · ${b.sourceName}` : ''}
                    </div>
                    <div style={{ ...S.badge, ...(b.published ? S.badgeOn : {}) }}>
                      {b.published ? 'Publicat' : 'Nepublicat'}
                    </div>
                  </div>
                </button>
                <div style={S.cardTools}>
                  <button onClick={() => copyLink(b)} style={S.toolBtn} title="Copiaza linkul">
                    {copiedId === b.id ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <a
                    href={`/album/${b.shareToken}`}
                    target="_blank"
                    rel="noreferrer"
                    style={S.toolBtn}
                    title="Deschide albumul"
                  >
                    <ExternalLink size={13} />
                  </a>
                  <button
                    onClick={() => remove(b)}
                    style={{ ...S.toolBtn, color: '#C0392B' }}
                    title="Sterge"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {creating && (
        <div style={S.modalBack} onClick={() => !busy && setCreating(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalHead}>
              <span>Album nou</span>
              <button onClick={() => setCreating(false)} style={S.iconBtn} aria-label="Inchide">
                <X size={16} />
              </button>
            </div>
            <div style={S.modalBody}>
              <label style={S.label}>Titlu</label>
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="ex. Nunta Ana & Mihai"
                style={S.input}
                autoFocus
              />

              <label style={{ ...S.label, marginTop: 12 }}>Sursa fotografiilor</label>
              {sourcesLoading ? (
                <p style={S.muted}>Se incarca sursele...</p>
              ) : (
                <div style={S.sourceList}>
                  {sources.map(s => (
                    <button
                      key={`${s.type}_${s.id || 'none'}`}
                      onClick={() => setNewSource(s)}
                      style={{
                        ...S.sourceBtn,
                        ...(newSource?.id === s.id && newSource?.type === s.type
                          ? S.sourceBtnActive
                          : {}),
                      }}
                    >
                      <span style={S.sourceType}>
                        {s.type === 'gallery' ? 'GALERIE' : s.type === 'class' ? 'CLASA' : 'INCARCARE'}
                      </span>
                      {s.name}
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={create}
                disabled={!newTitle.trim() || !newSource || busy}
                style={{
                  ...S.primaryBtn,
                  width: '100%',
                  justifyContent: 'center',
                  marginTop: 14,
                  opacity: !newTitle.trim() || !newSource || busy ? 0.45 : 1,
                  cursor: !newTitle.trim() || !newSource || busy ? 'not-allowed' : 'pointer',
                }}
              >
                {busy ? 'Se creeaza...' : 'Creeaza album'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const S: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: '100vh',
    backgroundColor: '#0C0B0A',
    color: '#F3EDE7',
    fontFamily: "'Outfit', system-ui, sans-serif",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '18px 24px',
    borderBottom: '1px solid #1E1C1A',
  },
  h1: { margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '0.04em' },
  sub: { margin: '2px 0 0', fontSize: 11, color: '#706E6A' },
  main: { padding: 24, maxWidth: 1100, margin: '0 auto' },
  muted: { color: '#706E6A', fontSize: 13 },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    padding: '70px 0',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
    gap: 12,
  },
  card: {
    border: '1px solid #1E1C1A',
    borderRadius: 10,
    backgroundColor: '#100E0D',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    padding: 12,
    background: 'none',
    border: 'none',
    color: 'inherit',
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
  },
  cardCover: {
    width: 52,
    height: 66,
    borderRadius: 5,
    backgroundColor: '#191716',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  cardImg: { width: '100%', height: '100%', objectFit: 'cover' },
  cardTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  cardMeta: { fontSize: 11, color: '#706E6A', marginTop: 3 },
  badge: {
    display: 'inline-block',
    marginTop: 7,
    padding: '2px 7px',
    borderRadius: 4,
    fontSize: 9.5,
    letterSpacing: '0.06em',
    backgroundColor: '#191716',
    color: '#8A8681',
  },
  badgeOn: { backgroundColor: 'rgba(212,175,55,0.14)', color: '#D4AF37' },
  cardTools: {
    display: 'flex',
    gap: 4,
    padding: '8px 12px',
    borderTop: '1px solid #1A1817',
  },
  toolBtn: {
    background: 'none',
    border: '1px solid #232120',
    borderRadius: 6,
    color: '#8A8681',
    padding: '5px 9px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    textDecoration: 'none',
  },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '9px 14px',
    borderRadius: 8,
    border: 'none',
    backgroundColor: '#5f0b02',
    color: '#FAF9F6',
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  iconBtn: { background: 'none', border: 'none', color: '#D8D0C8', cursor: 'pointer', display: 'flex' },
  modalBack: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(6,5,5,0.82)',
    zIndex: 900,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modal: {
    width: 'min(460px, 100%)',
    maxHeight: '84vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#111010',
    border: '1px solid #232120',
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 15px',
    borderBottom: '1px solid #1E1C1A',
    fontSize: 13,
  },
  modalBody: { padding: 15, overflowY: 'auto' },
  label: { display: 'block', fontSize: 10.5, color: '#8A8681', marginBottom: 5 },
  input: {
    width: '100%',
    padding: '9px 10px',
    borderRadius: 7,
    border: '1px solid #232120',
    backgroundColor: '#141211',
    color: '#F3EDE7',
    fontSize: 13,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  sourceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    maxHeight: 240,
    overflowY: 'auto',
  },
  sourceBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    borderRadius: 7,
    border: '1px solid #232120',
    backgroundColor: '#141211',
    color: '#B8B2AC',
    fontSize: 12,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
  },
  sourceBtnActive: {
    borderColor: '#D4AF37',
    color: '#D4AF37',
    backgroundColor: 'rgba(212,175,55,0.08)',
  },
  sourceType: {
    fontSize: 8.5,
    letterSpacing: '0.08em',
    color: '#706E6A',
    border: '1px solid #2D2A28',
    borderRadius: 3,
    padding: '2px 4px',
    flexShrink: 0,
  },
};
