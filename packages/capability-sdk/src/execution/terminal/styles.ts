export const terminalStyles = String.raw`
@keyframes cap-terminal-spin { to { transform: rotate(360deg); } }
.cap-terminal-spin { animation: cap-terminal-spin 1s linear infinite; }
.cap-terminal-dialog, .cap-terminal-drag-preview {
  --ct-surface: var(--panel, #fcfbf7);
  --ct-sidebar: var(--panel-soft, #f7f8f3);
  --ct-elevated: var(--panel-elevated, var(--panel, #fcfdf9));
  --ct-line: var(--border, #e5e7df);
  --ct-ink: var(--foreground, #283b32);
  --ct-muted: var(--muted, #849087);
  --ct-accent: var(--accent-strong, #426c52);
  --ct-selected: var(--accent-soft, #eaf0e5);
  --ct-accent-border: var(--accent-border, #9eb59a);
  --ct-hover: var(--control-hover-bg, #e9eee5);
  --ct-hover-ink: var(--control-hover-foreground, #355640);
  --ct-focus: var(--focus-ring, #83a888);
  --ct-danger: var(--danger, #a56555);
  --ct-danger-bg: color-mix(in srgb, var(--ct-danger) 12%, var(--ct-elevated));
  --ct-scrollbar: var(--scrollbar-thumb, #d5ddd2);
  --ct-shadow: var(--shadow-sm, 0 8px 24px #23372020, 0 2px 5px #23372008);
}
.cap-terminal-dialog { container: cap-terminal / inline-size; padding: 0; color: var(--ct-ink); background: var(--ct-surface); font: 13px/1.5 Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif; }
.cap-terminal-dialog * { box-sizing: border-box; }
.cap-terminal-dialog button, .cap-terminal-dialog input { font: inherit; }
.cap-terminal-dialog .floating-window-titlebar { gap: 8px; }
.cap-terminal-dialog .floating-window-titlebar > strong { white-space: nowrap; }
.cap-terminal-dialog .floating-window-titlebar > button { margin-left: auto; color: var(--ct-muted); }
.cap-terminal-count { flex-shrink: 0; margin-left: 4px; padding-left: 10px; border-left: 1px solid var(--ct-line); color: var(--ct-muted); font-size: 11px; white-space: nowrap; }
.cap-terminal-connection { display: grid; place-items: center; flex-shrink: 0; width: 20px; height: 24px; color: var(--ct-muted); }
.cap-terminal-connection i, .cap-terminal-state-dot { display: block; flex-shrink: 0; width: 5px; height: 5px; border-radius: 50%; background: var(--ct-muted); }
.cap-terminal-connection[data-status='connected'] i, .cap-terminal-state-dot[data-status='ready'] { background: #70a080; }
.cap-terminal-connection[data-status='error'] i { background: var(--ct-danger); }
.cap-terminal-state-dot[data-status='running'] { background: #b59b62; }
.cap-terminal-state-dot[data-status='starting'] { background: #8b9eae; }
.cap-terminal-dialog .cap-terminal-icon { display: inline-flex; align-items: center; justify-content: center; width: 29px; height: 29px; padding: 0; border: 0; border-radius: 7px; color: var(--ct-muted); background: transparent; cursor: pointer; }
.cap-terminal-dialog .cap-terminal-icon:hover:not(:disabled) { color: var(--ct-hover-ink); background: var(--ct-hover); }
.cap-terminal-dialog button:disabled { opacity: .35; cursor: default; }
.cap-terminal-dialog button:focus-visible { outline: 2px solid var(--ct-focus); outline-offset: 2px; }
.cap-terminal-body { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; }
.cap-terminal-create { display: grid; flex-shrink: 0; gap: 5px; margin: 0 8px 6px; padding: 6px; border: 1px solid var(--ct-line); border-radius: 8px; background: var(--ct-surface); }
.cap-terminal-create-name { display: flex; align-items: center; gap: 4px; min-width: 0; }
.cap-terminal-dialog .cap-terminal-create input { flex: 1; width: 100%; min-width: 0; height: 26px; margin: 0; padding: 3px 5px; border: 1px solid transparent; border-radius: 4px; outline: none; background: transparent; color: var(--ct-ink); font-size: 11px; line-height: 18px; text-overflow: ellipsis; }
.cap-terminal-create input::placeholder { color: var(--ct-muted); }
.cap-terminal-dialog .cap-terminal-create input:focus { border-color: var(--ct-focus); background: var(--ct-elevated); }
.cap-terminal-create-directory { display: flex; align-items: center; gap: 3px; min-width: 0; padding-left: 5px; color: var(--ct-muted); }
.cap-terminal-create-directory > svg { flex-shrink: 0; }
.cap-terminal-dialog .cap-terminal-create-submit { display: grid; place-items: center; flex: 0 0 26px; height: 26px; padding: 0; border: 0; border-radius: 5px; background: var(--ct-selected); color: var(--ct-accent); cursor: pointer; }
.cap-terminal-dialog .cap-terminal-create-submit:hover:not(:disabled) { background: var(--ct-hover); color: var(--ct-hover-ink); }
.cap-terminal-create-submit > span { display: flex; }
.cap-terminal-error { display: flex; align-items: center; gap: 14px; padding: 10px 20px; color: var(--ct-danger); background: var(--ct-danger-bg); font-size: 12px; overflow-wrap: anywhere; }
.cap-terminal-error > span { flex: 1; min-width: 0; }
.cap-terminal-error button { flex-shrink: 0; border: 0; border-bottom: 1px solid currentColor; padding: 0; color: inherit; background: transparent; cursor: pointer; }
.cap-terminal-layout { display: grid; grid-template-columns: 214px minmax(0, 1fr); flex: 1; min-height: 0; }
.cap-terminal-sidebar { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--ct-sidebar); border-right: 1px solid var(--ct-line); }
.cap-terminal-sidebar-top { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; height: 38px; padding: 4px 10px 4px 14px; color: var(--ct-muted); font-size: 11px; }
.cap-terminal-list { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 8px; scrollbar-width: thin; scrollbar-color: var(--ct-scrollbar) transparent; }
.cap-terminal-item { position: relative; display: grid; grid-template-columns: 16px minmax(0, 1fr) 5px 24px; align-items: center; gap: 8px; min-height: 38px; margin: 0 0 3px; padding: 5px 6px 5px 10px; border-radius: 6px; color: var(--ct-muted); transition: background .15s, color .15s; }
.cap-terminal-item:hover { background: var(--ct-hover); color: var(--ct-hover-ink); }
.cap-terminal-item[data-reorderable] { cursor: grab; touch-action: none; user-select: none; }
.cap-terminal-item.is-dragging { opacity: .3; background: var(--ct-selected); outline: 1px dashed var(--ct-accent-border); outline-offset: -1px; }
.cap-terminal-dialog .cap-terminal-list[data-reordering] :is(.cap-terminal-item, .cap-terminal-item-select) { cursor: grabbing; }
.cap-terminal-drag-preview { position: fixed; z-index: 1000; box-sizing: border-box; display: flex; align-items: center; gap: 11px; padding: 5px 13px 5px 10px; border: 1px solid var(--ct-accent-border); border-radius: 7px; color: var(--ct-accent); background: var(--ct-elevated); box-shadow: var(--ct-shadow); opacity: .95; font: 500 12px/20px Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif; pointer-events: none; user-select: none; transform: rotate(-1deg) scale(1.025); }
.cap-terminal-drag-preview > svg { flex-shrink: 0; color: var(--ct-muted); }
.cap-terminal-drag-preview > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cap-terminal-item-grip { display: grid; place-items: center; }
.cap-terminal-item-grip > svg { grid-area: 1 / 1; }
.cap-terminal-drag-icon { opacity: 0; }
.cap-terminal-item:hover .cap-terminal-item-icon { opacity: 0; }
.cap-terminal-item:hover .cap-terminal-drag-icon { opacity: 1; }
.cap-terminal-item[data-drop-position]::after { content: ''; position: absolute; left: 4px; right: 4px; height: 2px; border-radius: 2px; background: var(--ct-accent); pointer-events: none; }
.cap-terminal-item[data-drop-position='before']::after { top: -3px; }
.cap-terminal-item[data-drop-position='after']::after { bottom: -3px; }
.cap-terminal-item.is-selected { color: var(--ct-accent); background: var(--ct-selected); }
.cap-terminal-item.is-selected::before { content: ''; position: absolute; top: 10px; bottom: 10px; left: 0; width: 2px; border-radius: 2px; background: var(--ct-accent); }
.cap-terminal-dialog .cap-terminal-item-select, .cap-terminal-dialog .cap-terminal-rename { min-width: 0; width: 100%; height: 26px; margin: 0; padding: 2px 3px; border: 1px solid transparent; border-radius: 4px; color: inherit; background: transparent; font-size: 12px; font-weight: 500; line-height: 20px; text-align: left; }
.cap-terminal-dialog .cap-terminal-item-select { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: grab; }
.cap-terminal-dialog .cap-terminal-rename { outline: none; border-color: var(--ct-focus); background: var(--ct-elevated); }
.cap-terminal-dialog .cap-terminal-more { width: 24px; height: 24px; border-radius: 4px; opacity: 0; }
.cap-terminal-item:hover .cap-terminal-more, .cap-terminal-item:focus-within .cap-terminal-more, .cap-terminal-more[aria-expanded='true'] { opacity: 1; }
.cap-terminal-menu { position: fixed; inset: auto; box-sizing: border-box; width: 154px; margin: 0; padding: 5px; border: 1px solid var(--ct-line); border-radius: 9px; color: var(--ct-ink); background: var(--ct-elevated); box-shadow: var(--ct-shadow); }
.cap-terminal-dialog .cap-terminal-menu > button { display: flex; align-items: center; gap: 9px; width: 100%; height: 31px; padding: 5px 8px; border: 0; border-radius: 5px; background: transparent; color: inherit; font: 12px/1.4 Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif; text-align: left; cursor: pointer; transition: background-color .12s, color .12s; }
.cap-terminal-dialog .cap-terminal-menu > button:is(:hover, :focus-visible):not(:disabled) { background: var(--ct-hover); color: var(--ct-hover-ink); outline: none; }
.cap-terminal-menu > button:disabled { opacity: .35; cursor: default; }
.cap-terminal-menu kbd { margin-left: auto; color: var(--ct-muted); font: 10px ui-monospace, monospace; }
.cap-terminal-dialog .cap-terminal-menu > .cap-terminal-delete { color: var(--ct-danger); }
.cap-terminal-dialog .cap-terminal-menu > .cap-terminal-delete:is(:hover, :focus-visible):not(:disabled) { background: var(--ct-danger-bg); color: var(--ct-danger); }
.cap-terminal-list > p { margin: 8px 0; padding: 12px; color: var(--ct-muted); font-size: 12px; text-align: center; }
.cap-terminal-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #131917; }
.cap-terminal-viewport { flex: 1; min-height: 0; overflow: hidden; padding: 18px 14px 18px 20px; cursor: text; }
.cap-terminal-emulator { width: 100%; height: 100%; overflow: hidden; background: #131917; }
.cap-terminal-emulator .xterm { height: 100%; padding: 0; background: #131917; }
.cap-terminal-emulator .xterm-viewport, .cap-terminal-emulator .xterm-scrollable-element, .cap-terminal-emulator .xterm-screen { background-color: #131917; }
.cap-terminal-emulator .xterm .xterm-scrollable-element > .scrollbar.horizontal { display: none; }
.cap-terminal-emulator .xterm textarea.xterm-helper-textarea { min-height: 0; min-width: 0; padding: 0; border: 0; opacity: 0; resize: none; }
.cap-terminal-empty { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #718479; padding: 24px; text-align: center; }
.cap-terminal-empty > svg { flex-shrink: 0; }
.cap-terminal-empty strong { font-size: 14px; font-weight: 500; color: #afc1b4; }
.cap-terminal-empty p { font-size: 12px; margin: 0; }
@container cap-terminal (max-width: 640px) {
  .cap-terminal-dialog .floating-window-titlebar > small { display: none; }
  .cap-terminal-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .cap-terminal-sidebar { max-height: 230px; border-right: 0; border-bottom: 1px solid var(--ct-line); }
  .cap-terminal-list { display: flex; flex: 0 0 auto; align-items: flex-start; gap: 5px; overflow-x: auto; padding: 4px 8px 8px; }
  .cap-terminal-item { flex: 0 0 170px; margin: 0; }
  .cap-terminal-item[data-drop-position]::after { top: 4px; bottom: 4px; width: 2px; height: auto; }
  .cap-terminal-item[data-drop-position='before']::after { left: -3px; right: auto; }
  .cap-terminal-item[data-drop-position='after']::after { right: -3px; left: auto; }
  .cap-terminal-create { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .cap-terminal-viewport { padding-left: 15px; }
}
@media (hover: none) { .cap-terminal-dialog .cap-terminal-more { opacity: 1; } }
`;
