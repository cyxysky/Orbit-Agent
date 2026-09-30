export const floatingWindowStyles = String.raw`


.floating-window { position: fixed; z-index: 150; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; border: 1px solid var(--border, #dfe4d8); border-radius: 16px; background: var(--panel, #fcfbf7); box-shadow: 0 24px 80px #0004, 0 2px 12px #0002; }
.floating-window-titlebar { flex: 0 0 42px; display: flex; align-items: center; gap: 9px; padding: 0 14px; background: var(--panel, #fcfbf7); color: var(--foreground, #283b32); cursor: grab; touch-action: none; user-select: none; border-bottom: 1px solid var(--border, #dfe4d8); }
.floating-window-titlebar:active { cursor: grabbing; }
.floating-window-titlebar strong { font-size: 13px; }
.floating-window-titlebar small { margin-left: auto; font-size: 11px; color: var(--muted, #849087); }
.floating-window-titlebar button { display: grid; place-items: center; border: 0; background: transparent; padding: 5px; cursor: pointer; }
.floating-window-resize { position: absolute; right: 2px; bottom: 2px; z-index: 2; width: 20px; height: 20px; border: 0; border-radius: 3px; background: linear-gradient(135deg, transparent 40%, #89968e 42%, transparent 48%, transparent 59%, #89968e 61%, transparent 67%); cursor: nwse-resize; touch-action: none; }
@media (max-width: 600px) { .floating-window-titlebar small { display: none; } }





`;
