import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Check, ChevronLeft, ChevronRight, X, Image as ImageIcon, Send } from 'lucide-react';

interface PhotoItem {
  name: string;
  url: string;
  cleanUrl?: string;
  path: string;
  cleanPath?: string;
}

interface SubCollection {
  id: string;
  name: string;
  photos: PhotoItem[];
}

interface GalleryData {
  title: string;
  subtitle?: string;
  date?: string;
  subCollections: SubCollection[];
  selectionEnabled: boolean;
  selectionMinPhotos: number;
  selectionMaxPhotos: number;
}

type Step = 'cover' | 'album' | 'confirm' | 'done';

export const GallerySelector: React.FC = () => {
  const { galleryId } = useParams<{ galleryId: string }>();
  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [step, setStep] = useState<Step>('cover');
  const [selectedCover, setSelectedCover] = useState<PhotoItem | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<PhotoItem[]>([]);
  const [lightboxPhoto, setLightboxPhoto] = useState<PhotoItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const allPhotos: PhotoItem[] = React.useMemo(() => {
    if (!gallery) return [];
    const seen = new Set<string>();
    const result: PhotoItem[] = [];
    for (const sub of gallery.subCollections) {
      for (const p of sub.photos) {
        if (!seen.has(p.path)) { seen.add(p.path); result.push(p); }
      }
    }
    return result;
  }, [gallery]);

  const [columnsCount, setColumnsCount] = useState(5);
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      if (w > 1200) setColumnsCount(5);
      else if (w > 900) setColumnsCount(4);
      else if (w > 600) setColumnsCount(3);
      else setColumnsCount(2);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const distributePhotos = (photos: PhotoItem[], numCols: number) => {
    const cols: PhotoItem[][] = Array.from({ length: numCols }, () => []);
    const colHeights = new Array(numCols).fill(0);

    photos.forEach((photo) => {
      let minIdx = 0;
      let minHeight = colHeights[0];
      for (let i = 1; i < numCols; i++) {
        if (colHeights[i] < minHeight) {
          minHeight = colHeights[i];
          minIdx = i;
        }
      }
      cols[minIdx].push(photo);
      const aspect = aspectRatios[photo.path] || 1.33;
      const relativeHeight = 1 / aspect;
      colHeights[minIdx] += relativeHeight;
    });

    return cols;
  };

  const photoColumns = distributePhotos(allPhotos, columnsCount);

  useEffect(() => {
    const load = async () => {
      if (!galleryId) { setError('ID galerie lipsă.'); setLoading(false); return; }
      try {
        const snap = await getDoc(doc(db, 'photo_galleries', galleryId));
        if (!snap.exists()) { setError('Galeria nu a fost găsită.'); setLoading(false); return; }
        const data = snap.data() as GalleryData;
        if (!data.selectionEnabled) { setError('Link-ul de selecție este dezactivat pentru această galerie.'); setLoading(false); return; }
        setGallery(data);
      } catch (e) {
        console.error(e);
        setError('Eroare la încărcarea galeriei.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [galleryId]);

  const handleSubmit = async () => {
    if (!gallery || !galleryId) return;
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'gallery_selections'), {
        galleryId,
        galleryTitle: gallery.title,
        coverPhoto: selectedCover ? { name: selectedCover.name, url: selectedCover.url, path: selectedCover.path } : null,
        albumPhotos: selectedAlbum.map(p => ({ name: p.name, url: p.url, path: p.path })),
        minPhotos: gallery.selectionMinPhotos,
        maxPhotos: gallery.selectionMaxPhotos,
        submittedAt: new Date(),
        status: 'pending',
      });
      setStep('done');
    } catch (e: any) {
      console.error(e);
      alert(`Eroare la trimiterea selecției: ${e?.message || e}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleAlbumPhoto = (photo: PhotoItem) => {
    setSelectedAlbum(prev => {
      const exists = prev.some(p => p.path === photo.path);
      if (exists) return prev.filter(p => p.path !== photo.path);
      if (!gallery) return prev;
      if (prev.length >= gallery.selectionMaxPhotos) return prev;
      return [...prev, photo];
    });
  };

  const isAlbumSelected = (photo: PhotoItem) => selectedAlbum.some(p => p.path === photo.path);
  const isCoverSelected = (photo: PhotoItem) => selectedCover?.path === photo.path;

  /* ─── Loading ────────────────────────────────────── */
  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0C0B0A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Outfit, sans-serif' }}>
      <div style={{ textAlign: 'center', color: '#706E6A' }}>
        <div style={{ width: '40px', height: '40px', border: '2px solid #262423', borderTopColor: '#5f0b02', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <p>Se încarcă galeria...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
      </div>
    </div>
  );

  /* ─── Error ──────────────────────────────────────── */
  if (error || !gallery) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0C0B0A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Outfit, sans-serif' }}>
      <div style={{ textAlign: 'center', color: '#706E6A', maxWidth: '400px', padding: '32px' }}>
        <X size={48} style={{ color: '#E06C75', margin: '0 auto 16px', display: 'block' }} />
        <h2 style={{ color: '#FAF9F6', marginBottom: '8px' }}>Oops!</h2>
        <p>{error || 'Galeria nu a putut fi încărcată.'}</p>
      </div>
    </div>
  );

  const min = gallery.selectionMinPhotos;
  const max = gallery.selectionMaxPhotos;
  const albumCount = selectedAlbum.length;
  const canSubmit = albumCount >= min && albumCount <= max;

  /* ─── Done ───────────────────────────────────────── */
  if (step === 'done') return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0C0B0A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'Outfit, sans-serif', padding: '24px' }}>
      <div style={{ textAlign: 'center', maxWidth: '440px' }}>
        <div style={{ width: '72px', height: '72px', borderRadius: '50%', backgroundColor: 'rgba(95,11,2,0.15)', border: '2px solid #5f0b02', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
          <Check size={32} style={{ color: '#FAF9F6' }} />
        </div>
        <h1 style={{ fontSize: '28px', fontWeight: 400, color: '#FAF9F6', marginBottom: '12px' }}>Selecție trimisă!</h1>
        <p style={{ color: '#706E6A', lineHeight: 1.7, fontSize: '15px' }}>
          Fotograful a primit selecția ta. Vei fi contactat în curând cu detaliile albumului.
        </p>
        <div style={{ marginTop: '28px', padding: '16px', backgroundColor: '#131211', borderRadius: '8px', border: '1px solid #262423', textAlign: 'left' }}>
          <p style={{ color: '#706E6A', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px', margin: '0 0 10px 0' }}>Rezumat selecție</p>
          <p style={{ color: '#D8D0C8', fontSize: '13px', margin: '4px 0' }}>Copertă: <strong style={{ color: '#FAF9F6' }}>{selectedCover?.name || 'Nicio copertă'}</strong></p>
          <p style={{ color: '#D8D0C8', fontSize: '13px', margin: '4px 0' }}>Poze album: <strong style={{ color: '#5f0b02' }}>{selectedAlbum.length}</strong> fotografii</p>
        </div>
      </div>
    </div>
  );

  /* ─── Confirm ────────────────────────────────────── */
  if (step === 'confirm') return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0C0B0A', fontFamily: 'Outfit, sans-serif', color: '#FAF9F6' }}>
      <header style={{ height: '60px', borderBottom: '1px solid #1C1A19', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', position: 'sticky', top: 0, backgroundColor: 'rgba(12,11,10,0.97)', backdropFilter: 'blur(10px)', zIndex: 100 }}>
        <button onClick={() => setStep('album')} style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
          <ChevronLeft size={16} /> Înapoi
        </button>
        <span style={{ fontSize: '14px', fontWeight: 600 }}>{gallery.title}</span>
        <div style={{ width: '80px' }} />
      </header>

      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '40px 24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 400, marginBottom: '8px' }}>Confirmă selecția</h2>
        <p style={{ color: '#706E6A', marginBottom: '32px', fontSize: '14px' }}>Verifică selecția înainte de a o trimite fotografului.</p>

        {/* Cover */}
        <div style={{ marginBottom: '24px' }}>
          <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#706E6A', marginBottom: '12px', fontWeight: 600 }}>Copertă selectată</p>
          {selectedCover ? (
            <div style={{ position: 'relative', width: '180px', borderRadius: '6px', overflow: 'hidden', border: '2px solid #5f0b02' }}>
              <img src={selectedCover.url} alt={selectedCover.name} style={{ width: '100%', display: 'block' }} />
            </div>
          ) : (
            <p style={{ color: '#5C5A57', fontSize: '13px', fontStyle: 'italic' }}>Nicio copertă selectată</p>
          )}
        </div>

        {/* Album thumbnails */}
        <div style={{ marginBottom: '32px' }}>
          <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#706E6A', marginBottom: '12px', fontWeight: 600 }}>
            Poze album — <span style={{ color: '#5f0b02' }}>{albumCount}</span> selectate
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '6px' }}>
            {selectedAlbum.map((p, i) => (
              <div key={p.path} style={{ position: 'relative', borderRadius: '4px', overflow: 'hidden', aspectRatio: '1', cursor: 'pointer' }} onClick={() => toggleAlbumPhoto(p)}>
                <img src={p.url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', top: '3px', right: '3px', backgroundColor: '#5f0b02', borderRadius: '50%', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Check size={9} style={{ color: '#fff' }} />
                </div>
                <div style={{ position: 'absolute', bottom: '3px', left: '4px', fontSize: '10px', color: '#FAF9F6', fontWeight: 700, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>#{i + 1}</div>
              </div>
            ))}
          </div>
        </div>

        {!canSubmit && (
          <div style={{ marginBottom: '20px', padding: '12px 16px', backgroundColor: 'rgba(224,108,117,0.1)', border: '1px solid rgba(224,108,117,0.3)', borderRadius: '6px', fontSize: '13px', color: '#E06C75' }}>
            Trebuie să selectezi între <strong>{min}</strong> și <strong>{max}</strong> poze de album. Ai selectat {albumCount}.
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !canSubmit}
          style={{ width: '100%', padding: '14px', backgroundColor: canSubmit ? '#5f0b02' : '#2D2A28', color: '#FAF9F6', border: 'none', borderRadius: '6px', fontSize: '15px', fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', transition: 'all 0.2s', opacity: canSubmit ? 1 : 0.4 }}
        >
          {isSubmitting ? 'Se trimite...' : <><Send size={16} /> Trimite Selecția</>}
        </button>
      </div>
    </div>
  );

  /* ─── Cover & Album steps ────────────────────────── */
  const stepIndex = step === 'cover' ? 0 : 1;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0C0B0A', fontFamily: 'Outfit, sans-serif', color: '#FAF9F6', display: 'flex', flexDirection: 'column' }}>

      {/* Sticky header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 100, backgroundColor: 'rgba(12,11,10,0.96)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #1C1A19' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 24px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: '11px', color: '#706E6A', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Selecție foto</p>
            <h1 style={{ fontSize: '15px', fontWeight: 600, color: '#FAF9F6', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>{gallery.title}</h1>
          </div>

          {/* Step pills */}
          <div style={{ display: 'flex', gap: '4px', backgroundColor: '#131211', padding: '4px', borderRadius: '8px', border: '1px solid #1C1A19', flexShrink: 0 }}>
            {['1. Copertă', '2. Poze Album'].map((s, i) => (
              <button
                key={s}
                onClick={() => { if (i === 0) setStep('cover'); else setStep('album'); }}
                style={{ padding: '6px 12px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, backgroundColor: stepIndex === i ? '#5f0b02' : 'transparent', color: '#FAF9F6', transition: 'all 0.2s', whiteSpace: 'nowrap' }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Counter + CTA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            {step === 'cover' && (
              <span style={{ fontSize: '12px', color: selectedCover ? '#5f0b02' : '#706E6A', whiteSpace: 'nowrap' }}>
                {selectedCover ? '✓ Selectată' : 'Nicio copertă'}
              </span>
            )}
            {step === 'album' && (
              <span style={{ fontSize: '12px', whiteSpace: 'nowrap', color: albumCount >= min ? '#5f0b02' : '#706E6A', fontWeight: 600 }}>
                <span style={{ color: albumCount > 0 ? '#FAF9F6' : '#706E6A' }}>{albumCount}</span>
                <span style={{ color: '#706E6A', fontWeight: 400 }}> / {max}</span>
                {albumCount < min && albumCount > 0 && <span style={{ color: '#E06C75' }}> min {min}</span>}
              </span>
            )}
            {step === 'cover' ? (
              <button onClick={() => setStep('album')} style={{ padding: '8px 16px', backgroundColor: '#5f0b02', color: '#FAF9F6', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                Următor <ChevronRight size={14} />
              </button>
            ) : (
              <button onClick={() => setStep('confirm')} disabled={!canSubmit} style={{ padding: '8px 16px', backgroundColor: canSubmit ? '#5f0b02' : '#2D2A28', color: '#FAF9F6', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s', whiteSpace: 'nowrap', opacity: canSubmit ? 1 : 0.4 }}>
                Confirmă <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
        {/* Progress */}
        <div style={{ height: '2px', backgroundColor: '#1C1A19' }}>
          <div style={{ height: '100%', width: stepIndex === 0 ? '50%' : '100%', backgroundColor: '#5f0b02', transition: 'width 0.4s ease' }} />
        </div>
      </header>

      {/* Instruction */}
      <div style={{ backgroundColor: '#131211', borderBottom: '1px solid #1C1A19', padding: '10px 24px', textAlign: 'center' }}>
        {step === 'cover' && (
          <p style={{ margin: 0, fontSize: '13px', color: '#A09A94' }}>
            Apasă pe o fotografie pentru a o selecta ca <strong style={{ color: '#5f0b02' }}>copertă</strong>. Poți alege o singură poză.
          </p>
        )}
        {step === 'album' && (
          <p style={{ margin: 0, fontSize: '13px', color: '#A09A94' }}>
            Selectează între <strong style={{ color: '#5f0b02' }}>{min}</strong> și <strong style={{ color: '#5f0b02' }}>{max}</strong> fotografii pentru albumul tău.
            {albumCount > 0 && <span style={{ color: '#D8D0C8' }}> — {albumCount} selectate până acum.</span>}
          </p>
        )}
      </div>

      {/* Grid */}
      <main style={{ flex: 1, width: '100%', padding: '4px 4px 0', boxSizing: 'border-box' }}>
        {allPhotos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 24px', color: '#706E6A' }}>
            <ImageIcon size={40} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.3 }} />
            <p>Galeria nu conține fotografii.</p>
          </div>
        ) : (
          <div 
            style={{ 
              display: 'flex', 
              gap: columnsCount > 2 ? '4px' : '3px', 
              width: '100%', 
              boxSizing: 'border-box' 
            }}
          >
            {photoColumns.map((col, colIdx) => (
              <div 
                key={colIdx} 
                style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: columnsCount > 2 ? '4px' : '3px' 
                }}
              >
                {col.map(photo => {
                  const selCover = isCoverSelected(photo);
                  const selAlbum = isAlbumSelected(photo);
                  const isSelected = step === 'cover' ? selCover : selAlbum;
                  const maxReached = step === 'album' && albumCount >= max && !selAlbum;

                  return (
                    <div
                      key={photo.path}
                      onClick={() => setLightboxPhoto(photo)}
                      style={{
                        position: 'relative', 
                        width: '100%', 
                        cursor: 'pointer', 
                        borderRadius: '3px', 
                        overflow: 'hidden',
                        outline: isSelected ? `3px solid #5f0b02` : '3px solid transparent',
                        outlineOffset: '-3px', 
                        opacity: maxReached ? 0.5 : 1, 
                        transition: 'opacity 0.2s, outline 0.15s',
                      }}
                    >
                      <img 
                        src={photo.url} 
                        alt={photo.name} 
                        loading="lazy" 
                        style={{ width: '100%', display: 'block' }} 
                        onLoad={(e) => {
                          const storedRatio = aspectRatios[photo.path];
                          if (!storedRatio) {
                            const img = e.currentTarget;
                            const r = img.naturalWidth / img.naturalHeight;
                            setAspectRatios(prev => ({ ...prev, [photo.path]: r }));
                          }
                        }}
                      />

                      {/* Always-visible top-right select badge button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (maxReached) return;
                          if (step === 'cover') {
                            setSelectedCover(selCover ? null : photo);
                          } else {
                            toggleAlbumPhoto(photo);
                          }
                        }}
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          backgroundColor: isSelected ? '#5f0b02' : 'rgba(18, 17, 16, 0.75)',
                          border: isSelected ? 'none' : '1px solid rgba(255, 255, 255, 0.4)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                          cursor: maxReached ? 'not-allowed' : 'pointer',
                          zIndex: 2,
                          transition: 'all 0.2s ease',
                          padding: 0
                        }}
                        className="select-indicator-btn"
                        title={step === 'cover' ? "Selectează Copertă" : "Selectează pentru Album"}
                      >
                        <Check 
                          size={14} 
                          style={{ 
                            color: '#FAF9F6', 
                            opacity: isSelected ? 1 : 0, 
                            transition: 'opacity 0.2s ease' 
                          }} 
                          className="check-icon-indicator" 
                        />
                      </button>

                      {/* Album order badge */}
                      {step === 'album' && selAlbum && (
                        <div style={{ position: 'absolute', bottom: '6px', left: '6px', backgroundColor: 'rgba(18,17,16,0.85)', borderRadius: '3px', padding: '2px 5px', fontSize: '10px', color: '#FAF9F6', fontWeight: 700, zIndex: 2 }}>
                          #{selectedAlbum.findIndex(p => p.path === photo.path) + 1}
                        </div>
                      )}

                      {/* Cover tag visible in album step */}
                      {step === 'album' && selCover && (
                        <div style={{ position: 'absolute', top: '6px', left: '6px', backgroundColor: '#5f0b02', borderRadius: '3px', padding: '2px 5px', fontSize: '9px', color: '#FAF9F6', fontWeight: 700, letterSpacing: '0.05em', zIndex: 2 }}>
                          COPERTĂ
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Lightbox */}
      {lightboxPhoto && (
        <div onClick={() => setLightboxPhoto(null)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(8,7,6,0.97)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', flexDirection: 'column', gap: '20px' }}>
          <button onClick={() => setLightboxPhoto(null)} style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer' }}>
            <X size={24} />
          </button>
          <img src={lightboxPhoto.url} alt={lightboxPhoto.name} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '95vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: '4px', boxShadow: '0 10px 60px rgba(0,0,0,0.8)' }} />
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (step === 'cover') { setSelectedCover(isCoverSelected(lightboxPhoto) ? null : lightboxPhoto); }
              else { if (!(albumCount >= max && !isAlbumSelected(lightboxPhoto))) toggleAlbumPhoto(lightboxPhoto); }
              setLightboxPhoto(null);
            }}
            style={{ padding: '10px 28px', backgroundColor: '#5f0b02', color: '#FAF9F6', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}
          >
            {step === 'cover'
              ? (isCoverSelected(lightboxPhoto) ? '✓ Deselectează Coperta' : 'Selectează ca Copertă')
              : (isAlbumSelected(lightboxPhoto) ? '✓ Deselectează Poza' : 'Adaugă în Album')}
          </button>
        </div>
      )}

      <style>{`
        .select-indicator-btn:hover {
          background-color: rgba(95, 11, 2, 0.4) !important;
          border-color: #5f0b02 !important;
        }
        .select-indicator-btn:hover .check-icon-indicator {
          opacity: 0.6 !important;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};
