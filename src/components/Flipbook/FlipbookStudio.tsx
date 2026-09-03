/**
 * Album studio — the admin editor for interactive albums.
 *
 * Deliberately unlisted: nothing in the admin dashboard links here, and the
 * route is not discoverable from any other page. Writes require an authenticated
 * admin (enforced by Firestore rules), so an unlisted URL is convenience, not
 * the security boundary.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase/config';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
  Eye,
  Images,
  Columns,
  Layout as LayoutIcon,
  Plus,
  Trash2,
  Type as TypeIcon,
  Upload,
  X,
} from 'lucide-react';
import { LAYOUTS, blankPage, layoutById, makeId, relayoutPage } from './flipbookTypes';
import type {
  Flipbook,
  FlipbookPage,
  LayoutId,
  PageAspect,
  PageSlot,
  PageText,
  UploadedPhoto,
} from './flipbookTypes';
import { FlipbookPageView } from './FlipbookPageView';
import { FlipbookCoverView } from './FlipbookCoverView';

interface SourcePhoto {
  name: string;
  previewUrl: string;
  fullUrl: string;
  path: string;
  folder?: string;
}

type Selection =
  | { kind: 'page'; index: number }
  | { kind: 'cover' }
  | { kind: 'back' };

export const FlipbookStudio: React.FC = () => {
  const { flipbookId } = useParams<{ flipbookId: string }>();
  const navigate = useNavigate();

  const [book, setBook] = useState<Flipbook | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [sel, setSel] = useState<Selection>({ kind: 'cover' });
  const [selSlot, setSelSlot] = useState<number | null>(null);
  const [selTextId, setSelTextId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<SourcePhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [pickerFor, setPickerFor] = useState<{ kind: 'slot' | 'cover' | 'back' | 'spread'; index?: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [folderFilter, setFolderFilter] = useState<string>('__all__');
  // Rendered in batches: decoding several hundred ~1200px previews at once is
  // what made the picker show half-decoded, striped thumbnails.
  const [shown, setShown] = useState(48);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(true);

  /* ── Load ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!flipbookId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'flipbooks', flipbookId));
        if (cancelled) return;
        if (!snap.exists()) {
          navigate('/atelier-album', { replace: true });
          return;
        }
        setBook({ id: snap.id, ...snap.data() } as Flipbook);
      } catch (e) {
        console.error('Failed to load album:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [flipbookId, navigate]);

  /* ── Autosave ───────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!book || !flipbookId) return;
    // The first run after load is the load itself, not an edit.
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const { id, ...rest } = book;
        void id;
        await updateDoc(doc(db, 'flipbooks', flipbookId), {
          ...rest,
          updatedAt: serverTimestamp(),
        });
        setSavedAt(Date.now());
      } catch (e) {
        console.error('Album autosave failed:', e);
      } finally {
        setSaving(false);
      }
    }, 900);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [book, flipbookId]);

  /* ── Source photos ──────────────────────────────────────────────────── */
  const loadPhotos = useCallback(async () => {
    if (!book || photosLoading) return;
    // Uploads are merged in below, so re-running after an upload is intended.
    if (photos.length && book.sourceType !== 'upload') return;
    setPhotosLoading(true);
    try {
      const out: SourcePhoto[] = [];
      // Photos uploaded straight into this album always come first.
      (book.uploads || []).forEach(u => {
        out.push({ name: u.name, previewUrl: u.url, fullUrl: u.url, path: u.path, folder: 'Incarcate' });
      });
      if (book.sourceType === 'gallery') {
        const gSnap = await getDoc(doc(db, 'photo_galleries', book.sourceId));
        const subs = (gSnap.data()?.subCollections || []) as { id: string; name: string }[];
        for (const sub of subs) {
          const pSnap = await getDocs(
            query(
              collection(db, 'photo_galleries', book.sourceId, 'subcollections', sub.id, 'photos'),
              orderBy('order', 'asc')
            )
          );
          pSnap.docs.forEach(d => {
            const p = d.data() as Record<string, string>;
            if (p.isVideo) return;
            out.push({
              name: p.name,
              // Clean copies where available: an album should never show a watermark.
              previewUrl: p.previewCleanUrl || p.previewUrl || p.cleanUrl || p.url,
              fullUrl: p.cleanUrl || p.url,
              path: p.path,
              folder: sub.name,
            });
          });
        }
      } else if (book.sourceType === 'class' && book.sourceId) {
        const cSnap = await getDoc(doc(db, 'classes', book.sourceId));
        const gp = (cSnap.data()?.galleryPhotos || []) as Record<string, string>[];
        gp.forEach(p => {
          out.push({
            name: p.name,
            previewUrl: p.previewCleanUrl || p.cleanUrl || p.previewUrl || p.url,
            fullUrl: p.cleanUrl || p.url,
            path: p.path,
          });
        });
      }
      setPhotos(out);
    } catch (e) {
      console.error('Failed to load source photos:', e);
    } finally {
      setPhotosLoading(false);
    }
  }, [book, photos.length, photosLoading]);

  useEffect(() => {
    if (pickerFor) loadPhotos();
  }, [pickerFor, loadPhotos]);

  useEffect(() => { setShown(48); }, [folderFilter, pickerFor]);

  /** Upload files straight into this album. */
  const handleUpload = async (files: FileList | null) => {
    if (!files || !files.length || !book || !flipbookId) return;
    const list = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!list.length) return;
    setUploading({ done: 0, total: list.length });
    const added: UploadedPhoto[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      try {
        // Stored under galleries/ so the existing admin-write, public-read
        // Storage rule covers it without needing a new rule deployed.
        const path = `galleries/album_${flipbookId}/${Date.now()}_${file.name}`;
        const sref = ref(storage, path);
        await uploadBytes(sref, file);
        const url = await getDownloadURL(sref);
        added.push({ name: file.name, url, path });
      } catch (e) {
        console.error('Upload failed for', file.name, e);
      }
      setUploading({ done: i + 1, total: list.length });
    }
    if (added.length) {
      patch(b => ({ ...b, uploads: [...(b.uploads || []), ...added] }));
      setPhotos(prev => [
        ...added.map(u => ({ name: u.name, previewUrl: u.url, fullUrl: u.url, path: u.path, folder: 'Incarcate' })),
        ...prev,
      ]);
    }
    setUploading(null);
  };

  /* ── Mutations ──────────────────────────────────────────────────────── */
  const patch = (fn: (b: Flipbook) => Flipbook) => setBook(b => (b ? fn(b) : b));

  const patchPage = (index: number, fn: (p: FlipbookPage) => FlipbookPage) =>
    patch(b => ({ ...b, pages: b.pages.map((p, i) => (i === index ? fn(p) : p)) }));

  const currentPage = sel.kind === 'page' ? book?.pages[sel.index] : undefined;

  const addPage = () => {
    patch(b => ({ ...b, pages: [...b.pages, blankPage('single')] }));
    setSel({ kind: 'page', index: (book?.pages.length ?? 0) });
    setSelSlot(null);
    setSelTextId(null);
  };

  const deletePage = (index: number) => {
    if (!book) return;
    if (!confirm(`Stergi pagina ${index + 1}?`)) return;
    patch(b => ({ ...b, pages: b.pages.filter((_, i) => i !== index) }));
    setSel(s =>
      s.kind === 'page' && s.index >= index && s.index > 0
        ? { kind: 'page', index: s.index - 1 }
        : s
    );
  };

  const movePage = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (!book || to < 0 || to >= book.pages.length) return;
    patch(b => {
      const pages = [...b.pages];
      const [moved] = pages.splice(index, 1);
      pages.splice(to, 0, moved);
      return { ...b, pages };
    });
    setSel({ kind: 'page', index: to });
  };

  const assignPhoto = (photo: SourcePhoto) => {
    if (!pickerFor) return;
    if (pickerFor.kind === 'spread') {
      applySpread(photo);
      setPickerFor(null);
      return;
    }
    if (pickerFor.kind === 'slot' && sel.kind === 'page' && pickerFor.index !== undefined) {
      const slot: PageSlot = {
        previewUrl: photo.previewUrl,
        fullUrl: photo.fullUrl,
        path: photo.path,
        name: photo.name,
        focalX: 50,
        focalY: 50,
        zoom: 1,
      };
      patchPage(sel.index, p => ({
        ...p,
        slots: p.slots.map((s, i) => (i === pickerFor.index ? slot : s)),
      }));
    } else if (pickerFor.kind === 'cover' || pickerFor.kind === 'back') {
      const key = pickerFor.kind === 'cover' ? 'cover' : 'backCover';
      patch(b => ({
        ...b,
        [key]: { ...b[key], imageUrl: photo.previewUrl, focalX: 50, focalY: 50 },
      }));
    }
    setPickerFor(null);
  };

  /**
   * Place one photo across a facing pair of pages.
   *
   * Left-hand pages are the even indices and right-hand pages the odd ones, so
   * the pair is always (even, even+1). Selecting either page of a pair applies
   * the spread to both, and a missing right-hand page is created.
   */
  const applySpread = (photo: SourcePhoto) => {
    if (sel.kind !== 'page' || !book) return;
    const leftIdx = sel.index - (sel.index % 2);
    const rightIdx = leftIdx + 1;
    patch(b => {
      const pages = [...b.pages];
      while (pages.length <= rightIdx) pages.push(blankPage('full'));
      const base = {
        previewUrl: photo.previewUrl,
        fullUrl: photo.fullUrl,
        path: photo.path,
        name: photo.name,
        focalY: 50,
        zoom: 1,
      };
      pages[leftIdx] = {
        ...relayoutPage(pages[leftIdx], 'full'),
        slots: [{ ...base, spreadHalf: 'left' as const }],
      };
      pages[rightIdx] = {
        ...relayoutPage(pages[rightIdx], 'full'),
        slots: [{ ...base, spreadHalf: 'right' as const }],
      };
      return { ...b, pages };
    });
    setSel({ kind: 'page', index: leftIdx });
    setSelSlot(0);
  };

  /** Turn a two-page photo back into two independent pages. */
  const clearSpread = () => {
    if (sel.kind !== 'page') return;
    const leftIdx = sel.index - (sel.index % 2);
    patch(b => ({
      ...b,
      pages: b.pages.map((p, i) =>
        i === leftIdx || i === leftIdx + 1
          ? { ...p, slots: p.slots.map(sl => (sl ? { ...sl, spreadHalf: undefined } : sl)) }
          : p
      ),
    }));
  };

  const addText = () => {
    if (sel.kind !== 'page' || !currentPage) return;
    const home = layoutById(currentPage.layout).textHome;
    const t: PageText = {
      id: makeId('tx'),
      content: 'Text nou',
      x: home.x,
      y: home.y,
      w: home.w,
      size: 30,
      color: currentPage.layout === 'full' ? '#FFFFFF' : '#2A2724',
      align: 'center',
      font: 'serif',
      weight: 400,
    };
    patchPage(sel.index, p => ({ ...p, texts: [...p.texts, t] }));
    setSelTextId(t.id);
    setSelSlot(null);
  };

  const patchText = (id: string, fields: Partial<PageText>) => {
    if (sel.kind !== 'page') return;
    patchPage(sel.index, p => ({
      ...p,
      texts: p.texts.map(t => (t.id === id ? { ...t, ...fields } : t)),
    }));
  };

  const deleteText = (id: string) => {
    if (sel.kind !== 'page') return;
    patchPage(sel.index, p => ({ ...p, texts: p.texts.filter(t => t.id !== id) }));
    setSelTextId(null);
  };

  const shareUrl = book ? `${window.location.origin}/album/${book.shareToken}` : '';

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  if (loading) return <Center>Se incarca...</Center>;
  if (!book) return <Center>Albumul nu a fost gasit.</Center>;

  const selText = currentPage?.texts.find(t => t.id === selTextId) || null;
  const isSpreadPage = !!currentPage?.slots[0]?.spreadHalf;
  const selSlotData = selSlot !== null && currentPage ? currentPage.slots[selSlot] : null;

  return (
    <div style={S.shell}>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header style={S.header}>
        <button onClick={() => navigate('/atelier-album')} style={S.iconBtn} aria-label="Inapoi">
          <ArrowLeft size={17} />
        </button>
        <input
          value={book.title}
          onChange={e => patch(b => ({ ...b, title: e.target.value }))}
          style={S.titleInput}
          placeholder="Titlu album"
        />
        <span style={S.saveState}>
          {saving ? 'Se salveaza...' : savedAt ? 'Salvat' : ''}
        </span>
        <div style={{ flex: 1 }} />
        <label style={S.pubToggle}>
          <input
            type="checkbox"
            checked={book.published}
            onChange={e => patch(b => ({ ...b, published: e.target.checked }))}
          />
          Publicat
        </label>
        <button onClick={copyShare} style={S.ghostBtn} title={shareUrl}>
          {copied ? <Check size={14} /> : <Copy size={14} />} Link
        </button>
        <a href={shareUrl} target="_blank" rel="noreferrer" style={S.ghostBtn}>
          <Eye size={14} /> Previzualizare
        </a>
      </header>

      <div style={S.body}>
        {/* ── Left rail: pages ───────────────────────────────────────── */}
        <aside style={S.rail}>
          <div style={S.railHead}>PAGINI</div>

          <button
            onClick={() => { setSel({ kind: 'cover' }); setSelSlot(null); setSelTextId(null); }}
            style={{ ...S.thumb, ...(sel.kind === 'cover' ? S.thumbActive : {}) }}
          >
            <BookOpen size={13} /> Coperta fata
          </button>

          {book.pages.map((p, i) => (
            <div key={p.id} style={{ position: 'relative' }}>
              <button
                onClick={() => {
                  setSel({ kind: 'page', index: i });
                  setSelSlot(null);
                  setSelTextId(null);
                }}
                style={{
                  ...S.thumb,
                  ...(sel.kind === 'page' && sel.index === i ? S.thumbActive : {}),
                }}
              >
                <span style={S.thumbNum}>{i + 1}</span>
                {layoutById(p.layout).name}
              </button>
              {sel.kind === 'page' && sel.index === i && (
                <div style={S.thumbTools}>
                  <button onClick={() => movePage(i, -1)} disabled={i === 0} style={S.miniBtn}>↑</button>
                  <button onClick={() => movePage(i, 1)} disabled={i === book.pages.length - 1} style={S.miniBtn}>↓</button>
                  <button onClick={() => deletePage(i)} style={{ ...S.miniBtn, color: '#C0392B' }}>
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
          ))}

          <button
            onClick={() => { setSel({ kind: 'back' }); setSelSlot(null); setSelTextId(null); }}
            style={{ ...S.thumb, ...(sel.kind === 'back' ? S.thumbActive : {}) }}
          >
            <BookOpen size={13} /> Coperta spate
          </button>

          <button onClick={addPage} style={S.addPageBtn}>
            <Plus size={14} /> Adauga pagina
          </button>
        </aside>

        {/* ── Canvas ─────────────────────────────────────────────────── */}
        <main style={S.canvas}>
          {sel.kind === 'page' && currentPage ? (
            <FlipbookPageView
              page={currentPage}
              aspect={book.pageAspect}
              width={Math.min(560, PAGE_PREVIEW_W)}
              editing
              selectedSlot={selSlot}
              selectedTextId={selTextId}
              onSlotClick={i => {
                setSelSlot(i);
                setSelTextId(null);
                if (!currentPage.slots[i]) setPickerFor({ kind: 'slot', index: i });
              }}
              onTextClick={id => { setSelTextId(id); setSelSlot(null); }}
            />
          ) : (
            <FlipbookCoverView
              cover={sel.kind === 'cover' ? book.cover : book.backCover}
              aspect={book.pageAspect}
              width={Math.min(560, PAGE_PREVIEW_W)}
              isBack={sel.kind === 'back'}
            />
          )}
        </main>

        {/* ── Right rail: inspector ──────────────────────────────────── */}
        <aside style={S.inspector}>
          {sel.kind === 'page' && currentPage ? (
            <>
              <Section title="ASEZARE">
                <div style={S.layoutGrid}>
                  {LAYOUTS.map(l => (
                    <button
                      key={l.id}
                      onClick={() => patchPage(sel.index, p => relayoutPage(p, l.id as LayoutId))}
                      style={{
                        ...S.layoutBtn,
                        ...(currentPage.layout === l.id ? S.layoutBtnActive : {}),
                      }}
                    >
                      <LayoutIcon size={12} /> {l.name}
                    </button>
                  ))}
                </div>

                <button onClick={() => setPickerFor({ kind: 'spread' })} style={S.wideBtn}>
                  <Columns size={13} /> Foto pe doua pagini
                </button>
                {isSpreadPage ? (
                  <>
                    <p style={S.hint}>
                      Aceasta foto se intinde pe paginile {sel.index - (sel.index % 2) + 1} si{' '}
                      {sel.index - (sel.index % 2) + 2}, taiata exact la cotor.
                    </p>
                    <button onClick={clearSpread} style={{ ...S.wideBtn, color: '#C0392B' }}>
                      <Trash2 size={12} /> Anuleaza intinderea
                    </button>
                  </>
                ) : (
                  <p style={S.hint}>
                    Foloseste o poza intreaga: sistemul o taie la mijloc peste doua pagini alaturate.
                  </p>
                )}
              </Section>

              {selSlot !== null && (
                <Section title="FOTO SELECTATA">
                  <button onClick={() => setPickerFor({ kind: 'slot', index: selSlot })} style={S.wideBtn}>
                    <Images size={13} /> {selSlotData ? 'Schimba foto' : 'Alege foto'}
                  </button>
                  {selSlotData && (
                    <>
                      <Slider
                        label="Pozitie orizontala"
                        value={selSlotData.focalX ?? 50}
                        min={0}
                        max={100}
                        onChange={v =>
                          patchPage(sel.index, p => ({
                            ...p,
                            slots: p.slots.map((s, i) => (i === selSlot && s ? { ...s, focalX: v } : s)),
                          }))
                        }
                      />
                      <Slider
                        label="Pozitie verticala"
                        value={selSlotData.focalY ?? 50}
                        min={0}
                        max={100}
                        onChange={v =>
                          patchPage(sel.index, p => ({
                            ...p,
                            slots: p.slots.map((s, i) => (i === selSlot && s ? { ...s, focalY: v } : s)),
                          }))
                        }
                      />
                      <Slider
                        label="Zoom"
                        value={(selSlotData.zoom ?? 1) * 100}
                        min={100}
                        max={220}
                        onChange={v =>
                          patchPage(sel.index, p => ({
                            ...p,
                            slots: p.slots.map((s, i) => (i === selSlot && s ? { ...s, zoom: v / 100 } : s)),
                          }))
                        }
                      />
                      <button
                        onClick={() =>
                          patchPage(sel.index, p => ({
                            ...p,
                            slots: p.slots.map((s, i) => (i === selSlot ? null : s)),
                          }))
                        }
                        style={{ ...S.wideBtn, color: '#C0392B' }}
                      >
                        <Trash2 size={12} /> Scoate foto
                      </button>
                    </>
                  )}
                </Section>
              )}

              <Section title="TEXT">
                <button onClick={addText} style={S.wideBtn}>
                  <TypeIcon size={13} /> Adauga text
                </button>
                {currentPage.texts.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setSelTextId(t.id); setSelSlot(null); }}
                    style={{ ...S.textRow, ...(selTextId === t.id ? S.thumbActive : {}) }}
                  >
                    {t.content.slice(0, 26) || '(gol)'}
                  </button>
                ))}

                {selText && (
                  <div style={S.textEditor}>
                    <textarea
                      value={selText.content}
                      onChange={e => patchText(selText.id, { content: e.target.value })}
                      rows={3}
                      style={S.textarea}
                    />
                    <Row>
                      <Seg
                        options={[['left', 'Stanga'], ['center', 'Centru'], ['right', 'Dreapta']]}
                        value={selText.align}
                        onChange={v => patchText(selText.id, { align: v as PageText['align'] })}
                      />
                    </Row>
                    <Row>
                      <Seg
                        options={[['serif', 'Serif'], ['sans', 'Sans'], ['script', 'Script']]}
                        value={selText.font}
                        onChange={v => patchText(selText.id, { font: v as PageText['font'] })}
                      />
                    </Row>
                    <Slider label="Marime" value={selText.size} min={12} max={90}
                      onChange={v => patchText(selText.id, { size: v })} />
                    <Slider label="Pozitie X" value={selText.x} min={0} max={90}
                      onChange={v => patchText(selText.id, { x: v })} />
                    <Slider label="Pozitie Y" value={selText.y} min={0} max={94}
                      onChange={v => patchText(selText.id, { y: v })} />
                    <Slider label="Latime" value={selText.w} min={10} max={100}
                      onChange={v => patchText(selText.id, { w: v })} />
                    <Row>
                      <label style={S.fieldLabel}>Culoare</label>
                      <input
                        type="color"
                        value={selText.color}
                        onChange={e => patchText(selText.id, { color: e.target.value })}
                        style={S.color}
                      />
                    </Row>
                    <button onClick={() => deleteText(selText.id)} style={{ ...S.wideBtn, color: '#C0392B' }}>
                      <Trash2 size={12} /> Sterge text
                    </button>
                  </div>
                )}
              </Section>

              <Section title="FUNDAL PAGINA">
                <Row>
                  <label style={S.fieldLabel}>Culoare</label>
                  <input
                    type="color"
                    value={currentPage.bgColor || '#FFFFFF'}
                    onChange={e => patchPage(sel.index, p => ({ ...p, bgColor: e.target.value }))}
                    style={S.color}
                  />
                </Row>
              </Section>
            </>
          ) : (
            <CoverInspector
              cover={sel.kind === 'cover' ? book.cover : book.backCover}
              onChange={fields =>
                patch(b => {
                  const key = sel.kind === 'cover' ? 'cover' : 'backCover';
                  return { ...b, [key]: { ...b[key], ...fields } };
                })
              }
              onPick={() => setPickerFor({ kind: sel.kind === 'cover' ? 'cover' : 'back' })}
              aspect={book.pageAspect}
              onAspect={a => patch(b => ({ ...b, pageAspect: a }))}
              showAspect={sel.kind === 'cover'}
            />
          )}
        </aside>
      </div>

      {/* ── Photo picker ─────────────────────────────────────────────── */}
      {pickerFor && (() => {
        const folders = Array.from(new Set(photos.map(p => p.folder).filter(Boolean))) as string[];
        const filtered =
          folderFilter === '__all__' ? photos : photos.filter(p => p.folder === folderFilter);
        const visible = filtered.slice(0, shown);

        return (
          <div style={S.modalBack} onClick={() => !uploading && setPickerFor(null)}>
            <div style={S.pickModal} onClick={e => e.stopPropagation()}>
              <div style={S.modalHead}>
                <span>Alege o fotografie</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!!uploading}
                    style={S.uploadBtn}
                  >
                    <Upload size={13} />
                    {uploading ? `Se incarca ${uploading.done}/${uploading.total}...` : 'Incarca poze'}
                  </button>
                  <button onClick={() => setPickerFor(null)} style={S.iconBtn} aria-label="Inchide">
                    <X size={16} />
                  </button>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={e => {
                  handleUpload(e.target.files);
                  e.target.value = '';
                }}
              />

              {folders.length > 1 && (
                <div style={S.folderBar}>
                  <button
                    onClick={() => setFolderFilter('__all__')}
                    style={{ ...S.chip, ...(folderFilter === '__all__' ? S.chipActive : {}) }}
                  >
                    Toate ({photos.length})
                  </button>
                  {folders.map(f => (
                    <button
                      key={f}
                      onClick={() => setFolderFilter(f)}
                      style={{ ...S.chip, ...(folderFilter === f ? S.chipActive : {}) }}
                    >
                      {f} ({photos.filter(p => p.folder === f).length})
                    </button>
                  ))}
                </div>
              )}

              {photosLoading ? (
                <div style={S.modalEmpty}>Se incarca fotografiile...</div>
              ) : filtered.length === 0 ? (
                <div style={S.modalEmpty}>
                  Nicio fotografie disponibila. Foloseste "Incarca poze" pentru a adauga.
                </div>
              ) : (
                <div style={S.pickScroll}>
                  <div style={S.pickGrid}>
                    {visible.map(p => (
                      <button
                        key={p.path}
                        onClick={() => assignPhoto(p)}
                        style={S.pickCell}
                        title={p.name}
                      >
                        <img
                          src={p.previewUrl}
                          alt={p.name}
                          loading="lazy"
                          decoding="async"
                          style={S.pickImg}
                        />
                        <span style={S.pickName}>{p.name}</span>
                      </button>
                    ))}
                  </div>
                  {visible.length < filtered.length && (
                    <button onClick={() => setShown(v => v + 48)} style={S.moreBtn}>
                      Arata mai multe ({filtered.length - visible.length} ramase)
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

const PAGE_PREVIEW_W = 520;

/* ── Small pieces ─────────────────────────────────────────────────────── */

const CoverInspector: React.FC<{
  cover: Flipbook['cover'];
  onChange: (f: Partial<Flipbook['cover']>) => void;
  onPick: () => void;
  aspect: PageAspect;
  onAspect: (a: PageAspect) => void;
  showAspect: boolean;
}> = ({ cover, onChange, onPick, aspect, onAspect, showAspect }) => (
  <>
    <Section title="COPERTA">
      <button onClick={onPick} style={S.wideBtn}>
        <Images size={13} /> {cover.imageUrl ? 'Schimba imaginea' : 'Alege imaginea'}
      </button>
      <input
        value={cover.title}
        onChange={e => onChange({ title: e.target.value })}
        placeholder="Titlu"
        style={S.input}
      />
      <input
        value={cover.subtitle}
        onChange={e => onChange({ subtitle: e.target.value })}
        placeholder="Subtitlu"
        style={S.input}
      />
      <Row>
        <Seg
          options={[['full-bleed', 'Complet'], ['framed', 'Incadrat'], ['plain', 'Simplu']]}
          value={cover.style}
          onChange={v => onChange({ style: v as Flipbook['cover']['style'] })}
        />
      </Row>
      {cover.imageUrl && (
        <>
          <Slider label="Pozitie orizontala" value={cover.focalX ?? 50} min={0} max={100}
            onChange={v => onChange({ focalX: v })} />
          <Slider label="Pozitie verticala" value={cover.focalY ?? 50} min={0} max={100}
            onChange={v => onChange({ focalY: v })} />
        </>
      )}
      <Row>
        <Seg
          options={[['serif', 'Serif'], ['sans', 'Sans'], ['script', 'Script']]}
          value={cover.font || 'serif'}
          onChange={v => onChange({ font: v as PageText['font'] })}
        />
      </Row>
      <Slider
        label="Marime titlu"
        value={cover.titleSize ?? 58}
        min={24}
        max={110}
        onChange={v => onChange({ titleSize: v })}
      />
      <Row>
        <label style={S.fieldLabel}>Culoare fundal</label>
        <input type="color" value={cover.bgColor}
          onChange={e => onChange({ bgColor: e.target.value })} style={S.color} />
      </Row>
      <Row>
        <label style={S.fieldLabel}>Culoare text</label>
        <input type="color" value={cover.textColor}
          onChange={e => onChange({ textColor: e.target.value })} style={S.color} />
      </Row>
    </Section>

    {showAspect && (
      <Section title="FORMAT ALBUM">
        <Row>
          <Seg
            options={[['portrait', 'Portret'], ['square', 'Patrat'], ['landscape', 'Panoramic']]}
            value={aspect}
            onChange={v => onAspect(v as PageAspect)}
          />
        </Row>
        <p style={S.hint}>Se aplica tuturor paginilor.</p>
      </Section>
    )}
  </>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={S.section}>
    <div style={S.sectionTitle}>{title}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
  </div>
);

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
    {children}
  </div>
);

const Seg: React.FC<{
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}> = ({ options, value, onChange }) => (
  <div style={{ display: 'flex', gap: 4, width: '100%' }}>
    {options.map(([v, label]) => (
      <button
        key={v}
        onClick={() => onChange(v)}
        style={{ ...S.segBtn, ...(value === v ? S.segBtnActive : {}) }}
      >
        {label}
      </button>
    ))}
  </div>
);

const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, onChange }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={S.fieldLabel}>{label}</span>
      <span style={{ ...S.fieldLabel, color: '#8A8681' }}>{Math.round(value)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%', accentColor: '#D4AF37' }}
    />
  </div>
);

const Center: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ ...S.shell, alignItems: 'center', justifyContent: 'center', color: '#A09A94' }}>
    {children}
  </div>
);

/* ── Styles ───────────────────────────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  shell: {
    // A hard cap, not a floor: minHeight let the page rail's own content (60+
    // pages) grow the whole document taller than the viewport, so the browser
    // scrolled the header away instead of just the rail scrolling internally.
    height: '100vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#0C0B0A',
    color: '#F3EDE7',
    fontFamily: "'Outfit', system-ui, sans-serif",
  },
  header: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    borderBottom: '1px solid #1E1C1A',
    backgroundColor: '#100E0D',
  },
  titleInput: {
    background: 'none',
    border: 'none',
    color: '#F3EDE7',
    fontSize: 15,
    fontWeight: 600,
    fontFamily: 'inherit',
    outline: 'none',
    minWidth: 180,
  },
  saveState: { fontSize: 11, color: '#706E6A' },
  pubToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#D8D0C8',
    cursor: 'pointer',
  },
  body: { flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' },
  rail: {
    width: 210,
    borderRight: '1px solid #1E1C1A',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    overflowY: 'auto',
    backgroundColor: '#0E0D0C',
  },
  railHead: {
    fontSize: 10,
    letterSpacing: '0.08em',
    color: '#706E6A',
    fontWeight: 600,
    marginBottom: 2,
  },
  thumb: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    width: '100%',
    padding: '8px 9px',
    borderRadius: 7,
    border: '1px solid #232120',
    backgroundColor: '#141211',
    color: '#B8B2AC',
    fontSize: 12,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
  },
  thumbActive: { borderColor: '#D4AF37', color: '#D4AF37', backgroundColor: 'rgba(212,175,55,0.08)' },
  thumbNum: { fontSize: 10, color: '#706E6A', minWidth: 14 },
  thumbTools: { display: 'flex', gap: 4, padding: '4px 0 2px 6px' },
  miniBtn: {
    background: 'none',
    border: '1px solid #232120',
    borderRadius: 5,
    color: '#8A8681',
    fontSize: 11,
    width: 26,
    height: 22,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  addPageBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '9px',
    marginTop: 6,
    borderRadius: 7,
    border: '1px dashed #2D2A28',
    background: 'none',
    color: '#8A8681',
    fontSize: 12,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  canvas: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    overflow: 'auto',
    backgroundColor: '#080807',
  },
  inspector: {
    width: 264,
    borderLeft: '1px solid #1E1C1A',
    padding: 12,
    overflowY: 'auto',
    backgroundColor: '#0E0D0C',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionTitle: { fontSize: 10, letterSpacing: '0.08em', color: '#706E6A', fontWeight: 600 },
  layoutGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 },
  layoutBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '7px 6px',
    borderRadius: 6,
    border: '1px solid #232120',
    backgroundColor: '#141211',
    color: '#B8B2AC',
    fontSize: 10.5,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  layoutBtnActive: { borderColor: '#D4AF37', color: '#D4AF37' },
  wideBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    padding: '8px',
    borderRadius: 7,
    border: '1px solid #232120',
    backgroundColor: '#141211',
    color: '#D8D0C8',
    fontSize: 11.5,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  ghostBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 11px',
    borderRadius: 7,
    border: '1px solid #2D2A28',
    background: 'none',
    color: '#D8D0C8',
    fontSize: 11.5,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textDecoration: 'none',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    color: '#D8D0C8',
    cursor: 'pointer',
    display: 'flex',
    padding: 4,
  },
  input: {
    width: '100%',
    padding: '7px 9px',
    borderRadius: 6,
    border: '1px solid #232120',
    backgroundColor: '#141211',
    color: '#F3EDE7',
    fontSize: 12,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '7px 9px',
    borderRadius: 6,
    border: '1px solid #232120',
    backgroundColor: '#141211',
    color: '#F3EDE7',
    fontSize: 12,
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  textRow: {
    width: '100%',
    textAlign: 'left',
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid #232120',
    backgroundColor: '#141211',
    color: '#B8B2AC',
    fontSize: 11,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  textEditor: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    paddingTop: 8,
    borderTop: '1px solid #1E1C1A',
  },
  fieldLabel: { fontSize: 10.5, color: '#8A8681' },
  color: {
    width: 42,
    height: 24,
    padding: 0,
    border: '1px solid #232120',
    borderRadius: 5,
    background: 'none',
    cursor: 'pointer',
  },
  segBtn: {
    flex: 1,
    padding: '6px 4px',
    borderRadius: 6,
    border: '1px solid #232120',
    backgroundColor: '#141211',
    color: '#B8B2AC',
    fontSize: 10.5,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  segBtnActive: { borderColor: '#D4AF37', color: '#D4AF37' },
  hint: { fontSize: 10, color: '#706E6A', margin: 0 },
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
    width: 'min(940px, 100%)',
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
  modalEmpty: { padding: 40, textAlign: 'center', color: '#706E6A', fontSize: 13 },
  pickModal: {
    width: 'min(1100px, 100%)',
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#111010',
    border: '1px solid #232120',
    borderRadius: 12,
    overflow: 'hidden',
  },
  pickScroll: { overflowY: 'auto', padding: 12 },
  pickGrid: {
    display: 'grid',
    // Noticeably larger than before: the old 118px cells made it impossible to
    // tell one photo from another.
    gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
    gap: 10,
  },
  pickCell: {
    position: 'relative',
    padding: 0,
    border: '1px solid #232120',
    borderRadius: 8,
    overflow: 'hidden',
    background: '#0A0909',
    cursor: 'pointer',
    aspectRatio: '4 / 3',
    display: 'block',
  },
  pickImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  pickName: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: '4px 6px',
    fontSize: 9.5,
    color: '#E6E0D8',
    background: 'linear-gradient(0deg, rgba(0,0,0,0.78), rgba(0,0,0,0))',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textAlign: 'left',
  },
  folderBar: {
    display: 'flex',
    gap: 6,
    padding: '10px 12px',
    borderBottom: '1px solid #1E1C1A',
    overflowX: 'auto',
    flexShrink: 0,
  },
  chip: {
    padding: '5px 11px',
    borderRadius: 999,
    border: '1px solid #232120',
    backgroundColor: '#141211',
    color: '#B8B2AC',
    fontSize: 11,
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  chipActive: { borderColor: '#D4AF37', color: '#D4AF37', backgroundColor: 'rgba(212,175,55,0.08)' },
  uploadBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 7,
    border: '1px solid #2D2A28',
    backgroundColor: '#141211',
    color: '#D8D0C8',
    fontSize: 11.5,
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  moreBtn: {
    display: 'block',
    width: '100%',
    marginTop: 10,
    padding: '10px',
    borderRadius: 8,
    border: '1px dashed #2D2A28',
    background: 'none',
    color: '#8A8681',
    fontSize: 12,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
};
