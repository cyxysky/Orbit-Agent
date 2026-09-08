'use client';

// Adapted from Magic UI Dock (MIT): https://magicui.design/docs/components/dock
import { Children, cloneElement, forwardRef, isValidElement, useRef, type ReactNode, type CSSProperties } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue, type HTMLMotionProps } from 'motion/react';
import { cn } from '@/lib/utils';
import styles from './dock.module.css';

export type DockProps = Omit<HTMLMotionProps<'div'>, 'children'> & {
  children: ReactNode;
  iconSize?: number;
  iconMagnification?: number;
  iconDistance?: number;
  disableMagnification?: boolean;
  direction?: 'top' | 'middle' | 'bottom';
};

export const Dock = forwardRef<HTMLDivElement, DockProps>(function Dock({ children, className,
  iconSize = 40, iconMagnification = 60, iconDistance = 140, disableMagnification = false,
  direction = 'middle', style, ...props }, ref) {
  const mouseX = useMotionValue(Infinity);
  const reducedMotion = useReducedMotion();
  return (
    <motion.div {...props} ref={ref} className={cn(styles.dock, className)} data-direction={direction}
      style={{ '--dock-size': `${iconSize}px`, ...style } as CSSProperties}
      onPointerMove={event => { if (event.pointerType !== 'touch') mouseX.set(event.clientX); props.onPointerMove?.(event); }}
      onPointerLeave={event => { mouseX.set(Infinity); props.onPointerLeave?.(event); }}>
      {Children.map(children, child => isValidElement<DockIconProps>(child) && child.type === DockIcon
        ? cloneElement(child, { mouseX, size: iconSize, magnification: iconMagnification, distance: iconDistance, disableMagnification: disableMagnification || Boolean(reducedMotion) })
        : child)}
    </motion.div>
  );
});

export type DockIconProps = HTMLMotionProps<'div'> & {
  size?: number;
  magnification?: number;
  distance?: number;
  disableMagnification?: boolean;
  mouseX?: MotionValue<number>;
};

export function DockIcon({ children, className, size = 40, magnification = 60, distance = 140,
  disableMagnification = false, mouseX, style, ...props }: DockIconProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fallbackMouseX = useMotionValue(Infinity);
  const pointerX = mouseX ?? fallbackMouseX;
  const focused = useMotionValue(false);
  const offset = useTransform(() => {
    const x = pointerX.get();
    if (focused.get()) return 0;
    const bounds = ref.current?.getBoundingClientRect();
    return bounds ? x - bounds.x - bounds.width / 2 : Infinity;
  });
  const target = useTransform(offset, [-distance, 0, distance], [size, disableMagnification ? size : magnification, size]);
  const animatedSize = useSpring(target, { mass: 0.1, stiffness: 150, damping: 12 });
  return (
    <motion.div {...props} ref={ref} className={cn(styles.icon, className)}
      style={{ ...style, width: disableMagnification ? size : animatedSize, height: disableMagnification ? size : animatedSize }}
      onFocusCapture={event => { focused.set(true); props.onFocusCapture?.(event); }}
      onBlurCapture={event => { focused.set(false); props.onBlurCapture?.(event); }}>
      {children}
    </motion.div>
  );
}
