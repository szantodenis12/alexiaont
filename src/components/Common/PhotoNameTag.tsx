import React from 'react';

/**
 * The photo's file name ("XIA03247.jpg"), always visible in the corner of a
 * thumbnail — clients use it to tell the photographer exactly which photo they
 * mean. Always shown rather than on hover, because phones have no hover.
 *
 * The parent must be `position: relative`.
 */
export const PhotoNameTag: React.FC<{ name?: string; corner?: 'bottom-left' | 'bottom-right' }> = ({ name, corner = 'bottom-left' }) => {
  if (!name) return null;
  return (
    <span
      style={{
        position: 'absolute',
        bottom: '6px',
        ...(corner === 'bottom-left' ? { left: '6px' } : { right: '6px' }),
        maxWidth: 'calc(100% - 12px)',
        padding: '2px 6px',
        borderRadius: '3px',
        backgroundColor: 'rgba(10, 9, 8, 0.6)',
        color: '#FAF9F6',
        fontSize: '10.5px',
        fontWeight: 500,
        letterSpacing: '0.02em',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        pointerEvents: 'none',
        zIndex: 4,
        boxSizing: 'border-box',
      }}
    >
      {name}
    </span>
  );
};
