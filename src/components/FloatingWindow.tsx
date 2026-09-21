'use client';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Grip, X } from 'lucide-react';
type Bounds = { x: number; y: number; width: number; height: number };
function constrain(b: Bounds): Bounds {
  const w = Math.max(1, window.innerWidth - 24), h = Math.max(1, window.innerHeight - 24);
  const width = Math.min(w, Math.max(Math.min(480, w), b.width));
  const height = Math.min(h, Math.max(Math.min(320, h), b.height));
  return { width, height, x: Math.max(12, Math.min(window.innerWidth - width - 12, b.x)), y: Math.max(12, Math.min(window.innerHeight - height - 12, b.y)) };
}
export function FloatingWindow({ title, className = '', children, onClose }: { title: string; className?: string; children: ReactNode; onClose: () => void }) {
  const [bounds, setBounds] = useState<Bounds>();
  const drag = useRef<{ kind: 'move' | 'resize'; x: number; y: number; bounds: Bounds } | null>(null);
  useEffect(() => {
    setBounds(constrain({ x: window.innerWidth * .08, y: window.innerHeight * .08, width: Math.min(1100, window.innerWidth * .84), height: window.innerHeight * .8 }));
    const resize = () => setBounds(b => b && constrain(b));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  function start(e: PointerEvent<HTMLElement>, kind: 'move' | 'resize') {
    if (!bounds || e.button !== 0 || (kind === 'move' && (e.target as HTMLElement).closest('button'))) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, y: e.clientY, bounds };
  }
  function move(e: PointerEvent<HTMLElement>) {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    setBounds(constrain(d.kind === 'move' ? { ...d.bounds, x: d.bounds.x + dx, y: d.bounds.y + dy } : { ...d.bounds, width: d.bounds.width + dx, height: d.bounds.height + dy }));
  }
  if (!bounds) return null;
  return createPortal(<section role="dialog" aria-label={title} className={`floating-window ${className}`} style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}>
    <header className="floating-window-titlebar" onPointerDown={e => start(e, 'move')} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <Grip size={15} /><strong>{title}</strong><small>拖动标题栏移动 · 右下角调整大小</small><button type="button" aria-label="关闭窗口" onClick={onClose}><X size={17} /></button>
    </header>
    {children}
    <button className="floating-window-resize" aria-label="调整窗口大小，方向键微调" onPointerDown={e => start(e, 'resize')} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={e => { const dx = e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0; const dy = e.key === 'ArrowDown' ? 20 : e.key === 'ArrowUp' ? -20 : 0; if (dx || dy) { e.preventDefault(); setBounds(constrain({ ...bounds, width: bounds.width + dx, height: bounds.height + dy })); } }} />
  </section>, document.body);
}
