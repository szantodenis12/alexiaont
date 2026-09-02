/**
 * Front and back cover. Shared by the studio and the viewer, like the page
 * renderer, so the admin's preview is the real thing.
 */
import React from 'react';
import { FONT_STACKS, PAGE_W, pageHeight } from './flipbookTypes';
import type { FlipbookCover, PageAspect } from './flipbookTypes';

interface Props {
  cover: FlipbookCover;
  aspect: PageAspect;
  /** Rendered width in real pixels. A cover is one page, like a real book. */
  width: number;
  isBack?: boolean;
}

export const FlipbookCoverView: React.FC<Props> = ({ cover, aspect, width, isBack = false }) => {
  const H = pageHeight(aspect);
  // A closed book shows a single page, so the cover is composed at one page
  // wide. Composing it across a spread clipped the title in half.
  const scale = width / PAGE_W;

  return (
    <div
      style={{
        width,
        height: H * scale,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: cover.bgColor,
        boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
      }}
    >
      {cover.imageUrl && cover.style !== 'plain' && (
        <img
          src={cover.imageUrl}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            inset: cover.style === 'framed' ? `${H * scale * 0.07}px ${width * 0.08}px` : 0,
            width: cover.style === 'framed' ? '84%' : '100%',
            height: cover.style === 'framed' ? '86%' : '100%',
            objectFit: 'cover',
            objectPosition: `${cover.focalX ?? 50}% ${cover.focalY ?? 50}%`,
          }}
        />
      )}

      {/* Full-bleed covers need a scrim or the title disappears into the photo. */}
      {cover.style === 'full-bleed' && cover.imageUrl && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.05) 42%, rgba(0,0,0,0.62) 100%)',
          }}
        />
      )}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: isBack ? 'center' : 'flex-end',
          textAlign: 'center',
          padding: `${52 * scale}px ${46 * scale}px`,
          color: cover.textColor,
        }}
      >
        {cover.title && (
          <div
            style={{
              fontFamily: FONT_STACKS[cover.font || 'serif'],
              fontSize: Math.max(15, (cover.titleSize || 58) * scale),
              lineHeight: 1.15,
              letterSpacing: '0.02em',
              textShadow: cover.imageUrl ? '0 2px 20px rgba(0,0,0,0.5)' : undefined,
            }}
          >
            {cover.title}
          </div>
        )}
        {cover.subtitle && (
          <div
            style={{
              marginTop: Math.max(5, 18 * scale),
              fontFamily: FONT_STACKS.sans,
              fontSize: Math.max(9, 19 * scale),
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              opacity: 0.85,
              textShadow: cover.imageUrl ? '0 2px 16px rgba(0,0,0,0.5)' : undefined,
            }}
          >
            {cover.subtitle}
          </div>
        )}
      </div>
    </div>
  );
};
