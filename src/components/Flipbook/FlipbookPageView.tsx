/**
 * Renders one album page.
 *
 * Shared by the studio and the public viewer so the two can never drift — what
 * the admin composes is literally what a viewer sees. The page is laid out at a
 * fixed design size (PAGE_W x pageHeight) and scaled with a transform, so text
 * sizes and photo positions hold at any display size.
 */
import React from 'react';
import { FONT_STACKS, PAGE_W, layoutById, pageHeight, pageWidth } from './flipbookTypes';
import type { FlipbookPage, PageAspect } from './flipbookTypes';

interface Props {
  page: FlipbookPage;
  aspect: PageAspect;
  /** Rendered width in real pixels. */
  width: number;
  /** Studio only: outlines empty slots and marks the selected element. */
  editing?: boolean;
  selectedSlot?: number | null;
  selectedTextId?: string | null;
  onSlotClick?: (index: number) => void;
  onTextClick?: (id: string) => void;
  /** Page number printed in the corner; omit to hide. */
  pageNumber?: number;
}

export const FlipbookPageView: React.FC<Props> = ({
  page,
  aspect,
  width,
  editing = false,
  selectedSlot = null,
  selectedTextId = null,
  onSlotClick,
  onTextClick,
  pageNumber,
}) => {
  const W = pageWidth(aspect);
  const H = pageHeight(aspect);
  // Overscan by a pixel. Scaling by exactly width/W leaves the content a
  // fraction short of the container on non-integer scales, and the paper
  // backing shows through as a pale hairline down the spine and around the
  // page. The overflow is clipped, so the extra pixel is never seen.
  const scale = (width + 1) / W;
  // Text is authored against PAGE_W so a caption keeps its relative size when
  // the album format changes.
  const textScale = W / PAGE_W;
  const layout = layoutById(page.layout);

  return (
    <div
      style={{
        width,
        height: H * scale,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: page.bgColor || '#FFFFFF',
      }}
    >
      {/* Everything inside is authored at design size, then scaled as a unit. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: W,
          height: H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {layout.slots.map((rect, i) => {
          const slot = page.slots[i];
          const isSelected = editing && selectedSlot === i;
          return (
            <div
              key={i}
              onClick={editing ? () => onSlotClick?.(i) : undefined}
              style={{
                position: 'absolute',
                left: `${rect.x}%`,
                top: `${rect.y}%`,
                width: `${rect.w}%`,
                height: `${rect.h}%`,
                overflow: 'hidden',
                backgroundColor: slot ? 'transparent' : editing ? '#EFEBE6' : 'transparent',
                cursor: editing ? 'pointer' : 'default',
                outline: isSelected ? '3px solid #D4AF37' : 'none',
                outlineOffset: '-3px',
                border: editing && !slot ? '1px dashed #C9C1B8' : 'none',
                boxSizing: 'border-box',
              }}
            >
              {slot?.previewUrl ? (
                <img
                  src={slot.previewUrl}
                  alt={slot.name || ''}
                  draggable={false}
                  loading="lazy"
                  style={
                    slot.spreadHalf
                      ? {
                          // Cover the full spread, then slide so this page shows
                          // its own half. The seam lands exactly on the spine.
                          width: W * 2,
                          maxWidth: 'none',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: `50% ${slot.focalY ?? 50}%`,
                          marginLeft: slot.spreadHalf === 'right' ? -W : 0,
                          transform: slot.zoom && slot.zoom !== 1 ? `scale(${slot.zoom})` : undefined,
                          display: 'block',
                        }
                      : {
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: `${slot.focalX ?? 50}% ${slot.focalY ?? 50}%`,
                          transform: slot.zoom && slot.zoom !== 1 ? `scale(${slot.zoom})` : undefined,
                          display: 'block',
                        }
                  }
                />
              ) : editing ? (
                <span
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#A79F96',
                    fontSize: 20,
                    fontFamily: FONT_STACKS.sans,
                  }}
                >
                  + Foto
                </span>
              ) : null}
            </div>
          );
        })}

        {page.texts.map(t => {
          const isSelected = editing && selectedTextId === t.id;
          return (
            <div
              key={t.id}
              onClick={editing ? e => { e.stopPropagation(); onTextClick?.(t.id); } : undefined}
              style={{
                position: 'absolute',
                left: `${t.x}%`,
                top: `${t.y}%`,
                width: `${t.w}%`,
                color: t.color,
                fontFamily: FONT_STACKS[t.font],
                fontSize: t.size * textScale,
                fontWeight: t.weight,
                fontStyle: t.italic ? 'italic' : 'normal',
                letterSpacing: t.tracking ? `${t.tracking * textScale}px` : undefined,
                textAlign: t.align,
                lineHeight: 1.35,
                whiteSpace: 'pre-wrap',
                cursor: editing ? 'pointer' : 'default',
                outline: isSelected ? '2px solid #D4AF37' : 'none',
                outlineOffset: 4,
                // Photos sit behind text; a caption over a full-bleed photo needs
                // to stay readable without the admin having to pick a colour.
                textShadow: page.layout === 'full' ? '0 1px 12px rgba(0,0,0,0.45)' : undefined,
              }}
            >
              {t.content}
            </div>
          );
        })}

        {pageNumber !== undefined && (
          <div
            style={{
              position: 'absolute',
              bottom: 18,
              left: 0,
              width: '100%',
              textAlign: 'center',
              fontFamily: FONT_STACKS.sans,
              fontSize: 13,
              letterSpacing: 1,
              color: page.layout === 'full' ? 'rgba(255,255,255,0.75)' : '#A79F96',
            }}
          >
            {pageNumber}
          </div>
        )}
      </div>
    </div>
  );
};
