/**
 * Public album viewer, addressed by unguessable share token: /album/<token>.
 *
 * Modelled as a real book rather than a slideshow: the album is a stack of
 * leaves, each with a front and a back face. Turning rotates one leaf around
 * the spine, so the page you were reading becomes the left-hand page — exactly
 * as paper behaves. Leaves are stacked with z-index so the book has visible
 * thickness on both sides.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { ChevronLeft, ChevronRight, Share2, Check } from 'lucide-react';
import { FONT_STACKS, pageHeight, pageWidth } from './flipbookTypes';
import type { Flipbook, FlipbookPage } from './flipbookTypes';
import { FlipbookPageView } from './FlipbookPageView';
import { FlipbookCoverView } from './FlipbookCoverView';

/** One face of a leaf. */
type Face =
  | { kind: 'cover' }
  | { kind: 'back-cover' }
  | { kind: 'page'; index: number }
  /** The reverse of a cover: board stock, not a blank sheet of paper. */
  | { kind: 'inside-cover' }
  | { kind: 'blank' };

interface Leaf {
  front: Face;
  back: Face;
}

const TURN_MS = 780;

export const FlipbookViewer: React.FC = () => {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [book, setBook] = useState<Flipbook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Leaves with an index < turned are lying on the left. */
  const [turned, setTurned] = useState(0);
  const [anim, setAnim] = useState<{ leaf: number; dir: 1 | -1; t: number } | null>(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 860 : false
  );
  const [viewport, setViewport] = useState({ w: 1200, h: 900 });
  const [copied, setCopied] = useState(false);

  const dragRef = useRef<{ x: number } | null>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 860);
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!shareToken) {
        setError('Link invalid.');
        setLoading(false);
        return;
      }
      try {
        const snap = await getDocs(
          query(collection(db, 'flipbooks'), where('shareToken', '==', shareToken), limit(1))
        );
        if (snap.empty) {
          setError('Acest album nu exista sau linkul a fost dezactivat.');
        } else {
          const data = { id: snap.docs[0].id, ...snap.docs[0].data() } as Flipbook;
          if (!data.published) setError('Acest album nu este inca publicat.');
          else setBook(data);
        }
      } catch (e) {
        console.error('Failed to load album:', e);
        setError('Nu am putut incarca albumul.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [shareToken]);

  /**
   * Build the leaf stack.
   *
   * Leaf 0 is the cover: its back is the first page, so opening the book
   * reveals page 1 on the right. Subsequent leaves carry two pages each.
   */
  const leaves = useMemo<Leaf[]>(() => {
    if (!book) return [];
    const n = book.pages.length;
    const out: Leaf[] = [{ front: { kind: 'cover' }, back: n > 0 ? { kind: 'page', index: 0 } : { kind: 'blank' } }];
    let i = 1;
    while (i < n) {
      out.push({
        front: { kind: 'page', index: i },
        back: i + 1 < n ? { kind: 'page', index: i + 1 } : { kind: 'blank' },
      });
      i += 2;
    }
    // The back cover closes the book, mirroring the front: it lives on the BACK
    // of the final leaf, so turning that leaf leaves it facing the reader on a
    // closed book. Reuse the last leaf's free back where there is one, rather
    // than adding a blank spread just to carry it.
    const last = out[out.length - 1];
    if (last && last.back.kind === 'blank') {
      last.back = { kind: 'back-cover' };
    } else {
      // The front of the closing leaf is the inside of the back cover, which is
      // board stock. Rendering it as white paper looked like a stray blank page.
      out.push({ front: { kind: 'inside-cover' }, back: { kind: 'back-cover' } });
    }
    return out;
  }, [book]);

  const canPrev = turned > 0;
  // Desktop steps through leaves (two pages each); mobile steps through single
  // pages, so its ceiling is the page count plus the two covers. Using the leaf
  // count on mobile stopped the album halfway.
  const maxTurned = isMobile ? (book?.pages.length ?? 0) + 1 : leaves.length;
  // Turning the last step closes the book on the back cover.
  const canNext = turned < maxTurned;

  const go = (dir: 1 | -1) => {
    if (anim) return;
    if (dir === 1 && !canNext) return;
    if (dir === -1 && !canPrev) return;
    const leaf = dir === 1 ? turned : turned - 1;
    const started = performance.now();
    const step = (now: number) => {
      const raw = Math.min(1, (now - started) / TURN_MS);
      // Ease-in-out: paper accelerates off the stack and settles gently.
      const t = raw < 0.5 ? 4 * raw ** 3 : 1 - Math.pow(-2 * raw + 2, 3) / 2;
      setAnim({ leaf, dir, t });
      if (raw < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        setTurned(v => v + dir);
        setAnim(null);
      }
    };
    animRef.current = requestAnimationFrame(step);
  };

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  /**
   * Warm the browser cache for pages just ahead and behind, so a turn never
   * lands on an image that has not started downloading. Decoded images stay in
   * the cache, so this costs one fetch each.
   */
  useEffect(() => {
    if (!book) return;
    const wanted = new Set<string>();
    for (let p = (turned - 1) * 2; p <= turned * 2 + 5; p++) {
      const page = book.pages[p];
      if (!page) continue;
      page.slots.forEach(sl => { if (sl?.previewUrl) wanted.add(sl.previewUrl); });
    }
    if (book.cover.imageUrl) wanted.add(book.cover.imageUrl);
    if (book.backCover.imageUrl) wanted.add(book.backCover.imageUrl);
    wanted.forEach(src => { const img = new Image(); img.decoding = 'async'; img.src = src; });
  }, [book, turned]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (loading) return <Shell><div style={{ color: '#A09A94', fontSize: 14 }}>Se incarca albumul...</div></Shell>;
  if (error || !book) {
    return (
      <Shell>
        <div style={{ textAlign: 'center', color: '#A09A94', maxWidth: 420 }}>
          <p style={{ fontSize: 15, marginBottom: 6, color: '#F3EDE7' }}>{error}</p>
          <p style={{ fontSize: 13 }}>Verifica linkul primit sau contacteaza fotograful.</p>
        </div>
      </Shell>
    );
  }

  const H = pageHeight(book.pageAspect);
  const ratio = pageWidth(book.pageAspect) / H;
  // Fit the open book (two pages wide) into the viewport, leaving room for chrome.
  const availW = Math.min(viewport.w - 40, 1280);
  const availH = viewport.h - 170;
  const perPage = isMobile ? 1 : 2;
  let pageW = Math.min(availW / perPage, availH * ratio);
  pageW = Math.round(Math.max(160, pageW));
  const pageH = pageW / ratio;

  // A closed book is one page wide. Closed at the front only the right-hand
  // page exists, so shift left to centre it; closed at the back only the
  // left-hand page exists, so shift the other way.
  const closed = turned === 0 || turned >= leaves.length;
  const closedShift =
    turned === 0 ? -pageW / 2 : turned >= leaves.length ? pageW / 2 : 0;

  const renderFace = (face: Face, side: 'left' | 'right') => {
    if (face.kind === 'inside-cover') {
      return (
        <div style={{ width: pageW, height: pageH, background: book.backCover.bgColor || '#14110F' }} />
      );
    }
    if (face.kind === 'blank') {
      return <div style={{ width: pageW, height: pageH, background: '#F7F4F0' }} />;
    }
    if (face.kind === 'cover' || face.kind === 'back-cover') {
      return (
        <FlipbookCoverView
          cover={face.kind === 'cover' ? book.cover : book.backCover}
          aspect={book.pageAspect}
          width={pageW}
          isBack={face.kind === 'back-cover'}
        />
      );
    }
    const page: FlipbookPage | undefined = book.pages[face.index];
    if (!page) return <div style={{ width: pageW, height: pageH, background: '#F7F4F0' }} />;
    // A spread photo needs the join invisible, so it gets no gutter shading at
    // all -- that shading was exactly what put a dark band across the seam.
    const isSpreadHalf = !!page.slots[0]?.spreadHalf;
    return (
      <div style={{ position: 'relative' }}>
        <FlipbookPageView page={page} aspect={book.pageAspect} width={pageW} />
        {!isSpreadHalf && <PageSheen side={side} />}
      </div>
    );
  };

  /* ── Mobile: one page, simple flip ─────────────────────────────────── */
  if (isMobile) {
    const face: Face =
      turned === 0
        ? { kind: 'cover' }
        : turned > book.pages.length
          ? { kind: 'back-cover' }
          : { kind: 'page', index: turned - 1 };
    return (
      <Frame book={book} copied={copied} setCopied={setCopied}>
        <div
          style={{ ...ST.stage, perspective: '1800px' }}
          onPointerDown={e => (dragRef.current = { x: e.clientX })}
          onPointerUp={e => {
            const d = dragRef.current;
            dragRef.current = null;
            if (!d) return;
            const dx = e.clientX - d.x;
            if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1);
          }}
        >
          <div
            style={{
              // No shadow while a cover is showing -- see the desktop book
              // shadow below for the same rule and why.
              boxShadow:
                face.kind === 'cover' || face.kind === 'back-cover'
                  ? undefined
                  : '0 20px 50px rgba(0,0,0,0.55)',
              transformStyle: 'preserve-3d',
              transformOrigin: anim?.dir === 1 ? 'left center' : 'right center',
              transform: anim ? `rotateY(${anim.dir * -1 * anim.t * 150}deg)` : undefined,
              filter: anim ? `brightness(${1 - anim.t * 0.5})` : undefined,
            }}
          >
            {renderFace(face, 'right')}
          </div>
        </div>
        <Controls canPrev={canPrev} canNext={canNext} busy={!!anim} go={go} />
      </Frame>
    );
  }

  /* ── Desktop: open book ────────────────────────────────────────────── */
  return (
    <Frame book={book} copied={copied} setCopied={setCopied}>
      <div
        style={{ ...ST.stage, perspective: '2600px' }}
        onPointerDown={e => (dragRef.current = { x: e.clientX })}
        onPointerUp={e => {
          const d = dragRef.current;
          dragRef.current = null;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1);
        }}
      >
        <div
          style={{
            position: 'relative',
            width: pageW * 2,
            height: pageH,
            transformStyle: 'preserve-3d',
            // A closed book is one page wide, so slide it across to stay
            // centred; opening it glides back to the full spread.
            transform: `translateX(${closedShift}px)`,
            transition: anim ? 'none' : 'transform 0.5s cubic-bezier(0.32,0.72,0,1)',
          }}
        >
          {/* Closed-side page edges give the book physical thickness. */}
          {/* One shadow for the whole book. Suppressed while a cover is what's
              showing: the client edits her own cover art, and a drop shadow
              over it obscured the text and edits she had made. No fill: a
              filled version of this once showed as a blank page mid-turn,
              because `closed` only updates once the animation finishes. A
              box-shadow alone needs no fill and has no such lag. */}
          {!closed && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                height: pageH,
                left: 0,
                width: pageW * 2,
                boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
                zIndex: 0,
                transition: anim ? 'none' : undefined,
              }}
            />
          )}

          <PageEdges side="left" count={turned} pageH={pageH} />
          <PageEdges side="right" count={leaves.length - turned} pageH={pageH} />

          {leaves.map((leaf, i) => {
            const isTurning = anim?.leaf === i;
            const flipped = i < turned;
            // Base angle: 0 sitting on the right, -180 lying on the left.
            let angle = flipped ? -180 : 0;
            if (isTurning && anim) angle = anim.dir === 1 ? -180 * anim.t : -180 * (1 - anim.t);

            // Keep a window of leaves mounted around the split. Rendering only
            // the turning leaf left nothing behind it, so the dark stage showed
            // through mid-turn as a black flash.
            const visible = isTurning || Math.abs(i - turned) <= 2;
            if (!visible) return null;

            // Stacking, and the reason the left page used to show the previous
            // one: on the left, the most recently turned leaf lies on TOP of the
            // pile, so z must rise with i. On the right it is the opposite --
            // the next leaf to turn is the one you can see. The moving leaf
            // sits above both stacks.
            const z = isTurning
              ? leaves.length + 10
              : flipped
                ? i + 1
                : leaves.length - i;

            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: pageW,
                  width: pageW,
                  height: pageH,
                  transformStyle: 'preserve-3d',
                  transformOrigin: 'left center',
                  transform: `rotateY(${angle}deg)`,
                  willChange: isTurning ? 'transform' : undefined,
                  zIndex: z,
                  pointerEvents: isTurning ? 'none' : 'auto',
                }}
              >
                {isTurning ? (
                  <>
                    {/* Only a leaf in motion needs two faces. Rendering both on
                        every leaf put two coplanar surfaces on screen, which
                        z-fight and flicker; a hair of depth separates them. */}
                    <div
                      style={{
                        ...ST.face,
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden',
                        transform: 'translateZ(0.4px)',
                      }}
                    >
                      {renderFace(leaf.front, 'right')}
                      <TurnShade amount={anim ? anim.t : 0} from="left" />
                    </div>
                    <div
                      style={{
                        ...ST.face,
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden',
                        transform: 'rotateY(180deg) translateZ(0.4px)',
                      }}
                    >
                      {renderFace(leaf.back, 'left')}
                      <TurnShade amount={anim ? 1 - anim.t : 0} from="right" />
                    </div>
                  </>
                ) : (
                  /* At rest only one side of a leaf can be seen, so render just
                     that one: no coplanar pair, nothing to z-fight. A turned
                     leaf is rotated 180deg, so its back face has to be rotated
                     back or the page renders mirrored. */
                  <div
                    style={{
                      ...ST.face,
                      transform: flipped ? 'rotateY(180deg)' : undefined,
                    }}
                  >
                    {flipped ? renderFace(leaf.back, 'left') : renderFace(leaf.front, 'right')}
                  </div>
                )}
              </div>
            );
          })}

          {/* Spine sits above the pages so the gutter reads as a real fold. */}
          {!closed && (
            <div style={{ ...ST.spine, left: pageW - 12, height: pageH, zIndex: leaves.length + 20 }} />
          )}
        </div>
      </div>

      <Controls canPrev={canPrev} canNext={canNext} busy={!!anim} go={go} />
    </Frame>
  );
};

/* ── Pieces ───────────────────────────────────────────────────────────── */

/** Shading that sweeps across a leaf as it turns, standing in for the curl. */
const TurnShade: React.FC<{ amount: number; from: 'left' | 'right' }> = ({ amount, from }) =>
  amount <= 0.01 ? null : (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background:
          from === 'left'
            ? `linear-gradient(90deg, rgba(0,0,0,${0.42 * amount}) 0%, rgba(0,0,0,${0.1 * amount}) 42%, rgba(0,0,0,0) 78%)`
            : `linear-gradient(270deg, rgba(0,0,0,${0.42 * amount}) 0%, rgba(0,0,0,${0.1 * amount}) 42%, rgba(0,0,0,0) 78%)`,
      }}
    />
  );

/**
 * A soft shadow down the gutter of an ordinary (non-spread) page, as light
 * falls into the fold. Lowered and widened from the original: at 16% opacity
 * closing within 16% of the page width it read as a hard seam rather than a
 * gentle one, which is what prompted this pass.
 */
const PageSheen: React.FC<{ side: 'left' | 'right' }> = ({ side }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      background:
        side === 'right'
          ? 'linear-gradient(90deg, rgba(0,0,0,0.09) 0%, rgba(0,0,0,0.02) 10%, rgba(0,0,0,0) 26%)'
          : 'linear-gradient(270deg, rgba(0,0,0,0.09) 0%, rgba(0,0,0,0.02) 10%, rgba(0,0,0,0) 26%)',
    }}
  />
);

/** Stacked sheet edges, so a thick book looks thick. */
const PageEdges: React.FC<{ side: 'left' | 'right'; count: number; pageH: number }> = ({
  side,
  count,
  pageH,
}) => {
  const n = Math.max(0, Math.min(7, Math.floor(count / 2)));
  if (!n) return null;
  return (
    <>
      {Array.from({ length: n }, (_, k) => (
        <div
          key={k}
          style={{
            position: 'absolute',
            top: 3 + k * 0.7,
            height: pageH - 6 - k * 1.4,
            width: 3,
            [side]: -(k + 1) * 2.1,
            background: k % 2 ? '#E6E0D8' : '#D6CEC4',
            borderRadius: side === 'left' ? '3px 0 0 3px' : '0 3px 3px 0',
            zIndex: 0,
          }}
        />
      ))}
    </>
  );
};

const Controls: React.FC<{
  canPrev: boolean;
  canNext: boolean;
  busy: boolean;
  go: (d: 1 | -1) => void;
}> = ({ canPrev, canNext, busy, go }) => (
  <footer style={ST.footer}>
    <NavBtn disabled={!canPrev || busy} onClick={() => go(-1)} label="Pagina anterioara">
      <ChevronLeft size={20} />
    </NavBtn>
    <NavBtn disabled={!canNext || busy} onClick={() => go(1)} label="Pagina urmatoare">
      <ChevronRight size={20} />
    </NavBtn>
  </footer>
);

const Frame: React.FC<{
  book: Flipbook;
  copied: boolean;
  setCopied: (v: boolean) => void;
  children: React.ReactNode;
}> = ({ book, copied, setCopied, children }) => {
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: book.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* dismissed */ }
  };
  return (
    <div style={ST.shell}>
      <header style={ST.header}>
        <h1 style={ST.h1}>{book.title}</h1>
        <button onClick={share} style={ST.shareBtn}>
          {copied ? <Check size={13} /> : <Share2 size={13} />}
          {copied ? 'Copiat' : 'Distribuie'}
        </button>
      </header>
      {children}
    </div>
  );
};

const NavBtn: React.FC<{
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}> = ({ disabled, onClick, label, children }) => (
  <button onClick={onClick} disabled={disabled} aria-label={label}
    style={{ ...ST.navBtn, color: disabled ? '#3A3633' : '#D8D0C8', cursor: disabled ? 'default' : 'pointer' }}>
    {children}
  </button>
);

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ ...ST.shell, alignItems: 'center', justifyContent: 'center' }}>{children}</div>
);

const ST: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: '100vh',
    backgroundColor: '#0C0B0A',
    color: '#F3EDE7',
    fontFamily: FONT_STACKS.sans,
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '18px 22px 6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  h1: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  shareBtn: {
    background: 'none',
    border: '1px solid #2D2A28',
    borderRadius: 8,
    color: '#D8D0C8',
    padding: '7px 12px',
    fontSize: 12,
    fontFamily: 'inherit',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
  },
  stage: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '14px 12px 0',
    touchAction: 'pan-y',
    userSelect: 'none',
  },
  face: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    // Paper backing: if an image is still decoding, the gap reads as page
    // stock rather than a black hole.
    backgroundColor: '#FBF9F6',
    // No shadow here on purpose: a box-shadow blurs around a face's entire
    // perimeter, so two adjacent pages each cast shadow toward one another at
    // the spine -- doubling up exactly where a two-page photo needs the join
    // invisible. The book casts one shadow instead, from a single element
    // behind the whole stack.
  },
  spine: {
    position: 'absolute',
    top: 0,
    width: 24,
    pointerEvents: 'none',
    background:
      'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.28) 35%, rgba(0,0,0,0.42) 50%, rgba(0,0,0,0.28) 65%, rgba(0,0,0,0) 100%)',
  },
  footer: {
    padding: '16px 22px 22px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  navBtn: {
    background: 'none',
    border: '1px solid #2D2A28',
    borderRadius: '50%',
    width: 42,
    height: 42,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s',
  },
};
