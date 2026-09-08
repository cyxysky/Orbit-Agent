'use client';

// Adapted from Magic UI Pixel Image (MIT): https://magicui.design/docs/components/pixel-image
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ComponentProps } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import styles from './pixel-image.module.css';

type Grid = { rows: number; cols: number };
const grids = {
  '6x4': { rows: 4, cols: 6 }, '8x8': { rows: 8, cols: 8 }, '8x3': { rows: 3, cols: 8 },
  '4x6': { rows: 6, cols: 4 }, '3x8': { rows: 8, cols: 3 },
} as const;

export type PixelImageProps = Omit<ComponentProps<'img'>, 'src' | 'ref'> & {
  src: string;
  grid?: keyof typeof grids;
  customGrid?: Grid;
  grayscaleAnimation?: boolean;
  pixelFadeInDuration?: number;
  maxAnimationDelay?: number;
  colorRevealDelay?: number;
};

export function PixelImage(props: PixelImageProps) {
  return <PixelImageContent key={props.src} {...props} />;
}

function PixelImageContent({ src, alt = '', className, grid = '6x4', customGrid,
  grayscaleAnimation = true, pixelFadeInDuration = 1000, maxAnimationDelay = 1200,
  colorRevealDelay = 1300, onLoad, onError, ...imageProps }: PixelImageProps) {
  const container = useRef<HTMLSpanElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const inView = useInView(container, { once: true });
  const reducedMotion = useReducedMotion();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [complete, setComplete] = useState(false);
  const validGrid = customGrid && [customGrid.rows, customGrid.cols].every(value => Number.isInteger(value) && value >= 1 && value <= 16);
  const { rows, cols } = customGrid && validGrid ? customGrid : grids[grid];
  const duration = Math.max(0, pixelFadeInDuration);
  const delay = Math.max(0, maxAnimationDelay);
  const colorDelay = Math.max(0, colorRevealDelay);
  const reveal = loaded && inView;
  const showOriginal = complete || failed || Boolean(reducedMotion);

  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth > 0) setLoaded(true);
  }, []);

  useEffect(() => {
    if (!reveal || reducedMotion) return;
    const timeout = window.setTimeout(() => setComplete(true), Math.max(delay, grayscaleAnimation ? colorDelay : 0) + duration);
    return () => window.clearTimeout(timeout);
  }, [reveal, reducedMotion, delay, duration, grayscaleAnimation, colorDelay]);

  const pieces = useMemo(() => Array.from({ length: rows * cols }, (_, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    return {
      clipPath: `inset(${row * 100 / rows}% ${100 - (col + 1) * 100 / cols}% ${100 - (row + 1) * 100 / rows}% ${col * 100 / cols}%)`,
      // Stable scattered ordering avoids random server/client markup differences.
      delay: ((index * 0.61803398875) % 1) * delay,
    };
  }), [rows, cols, delay]);

  return (
    <span ref={container} className={cn(styles.root, className)} data-complete={showOriginal || undefined}
      style={{ '--pixel-duration': `${duration}ms`, '--pixel-color-delay': `${colorDelay}ms` } as CSSProperties}>
      <img {...imageProps} ref={image} className={styles.original} src={src} alt={alt}
        onLoad={event => { setLoaded(true); onLoad?.(event); }}
        onError={event => { setFailed(true); onError?.(event); }} />
      {reveal && !showOriginal ? (
        <span aria-hidden="true" className={cn(styles.pieces, grayscaleAnimation && styles.grayscale)}>
          {pieces.map((piece, index) => (
            <span key={index} className={styles.piece} style={{ clipPath: piece.clipPath, animationDelay: `${piece.delay}ms` }}>
              <img src={src} alt="" draggable={false} decoding="async" referrerPolicy={imageProps.referrerPolicy} crossOrigin={imageProps.crossOrigin} />
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}
