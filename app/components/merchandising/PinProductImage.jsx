import { useEffect, useMemo, useState } from 'react';
import { pinImageUrl } from '../../utils/pinProductImages.js';

const EMPTY_IMAGES = [];

export default function PinProductImage({ image, fallbackImages = EMPTY_IMAGES, alt = '' }) {
  const candidates = useMemo(() => [...new Set([
    pinImageUrl(image),
    ...fallbackImages.map(pinImageUrl),
  ].filter(Boolean))], [image, fallbackImages]);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [candidates]);

  return candidates[index] ? (
    <img
      src={candidates[index]}
      alt={alt}
      onError={() => setIndex(current => current + 1)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#fff' }}
    />
  ) : (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '12px' }}>
      No Img
    </div>
  );
}
