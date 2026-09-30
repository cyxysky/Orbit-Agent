export const terminalStyles = String.raw`
@keyframes cap-terminal-spin { to { transform: rotate(360deg); } }
.cap-terminal-spin { animation: cap-terminal-spin 1s linear infinite; }
.cap-terminal-dialog { --ct-surface: #fcfbf7; --ct-line: #e5e7df; --ct-ink: #283b32; --ct-muted: #849087; --ct-accent: #426c52; box-sizing: border-box; position: fixed; inset: 0; margin: auto; width: min(980px, calc(100vw - 32px)); height: min(690px, calc(100dvh - 64px)); max-width: none; max-height: none; padding: 0; border: 1px solid #ffffffb3; border-radius: 20px; color: var(--ct-ink); background: var(--ct-surface); box-shadow: 0 32px 100px #10211740, 0 3px 12px #10211714; overflow: hidden; font: 13px/1.5 Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif; }
.cap-terminal-dialog[open] { display: flex; flex-direction: column; }
.cap-terminal-dialog::backdrop { background: #16251e40; backdrop-filter: blur(5px); }
.cap-terminal-dialog * { box-sizing: border-box; }
.cap-terminal-dialog button, .cap-terminal-dialog input { font: inherit; }
.cap-terminal-header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--ct-line); }
.cap-terminal-heading { display: flex; align-items: center; gap: 13px; flex: 1; min-width: 0; }
.cap-terminal-heading-icon { display: grid; place-items: center; flex: 0 0 32px; height: 32px; border: 1px solid #dce6da; border-radius: 9px; color: #527b5d; background: #eff3eb; }
.cap-terminal-heading-copy { display: flex; align-items: center; gap: 13px; min-width: 0; }
.cap-terminal-heading h2 { flex-shrink: 0; margin: 0; font-size: 14px; letter-spacing: -.3px; font-weight: 650; white-space: nowrap; }
.cap-terminal-heading p { display: flex; align-items: center; gap: 10px; min-width: 0; margin: 0; color: var(--ct-muted); font-size: 11px; }
.cap-terminal-context { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cap-terminal-count { flex-shrink: 0; padding-left: 10px; border-left: 1px solid var(--ct-line); white-space: nowrap; }
.cap-terminal-dialog:focus { outline: none; }
.cap-terminal-connection { display: grid; place-items: center; flex-shrink: 0; width: 20px; height: 24px; color: #94a096; }
.cap-terminal-connection i, .cap-terminal-state-dot { display: block; flex-shrink: 0; width: 5px; height: 5px; border-radius: 50%; background: #aab1ac; }
.cap-terminal-connection[data-status='connected'] i, .cap-terminal-state-dot[data-status='ready'] { background: #70a080; }
.cap-terminal-connection[data-status='error'] i { background: #c67866; }
.cap-terminal-state-dot[data-status='running'] { background: #b59b62; }
.cap-terminal-state-dot[data-status='starting'] { background: #8b9eae; }
.cap-terminal-dialog .cap-terminal-new { display: inline-flex; align-items: center; justify-content: center; gap: 7px; flex-shrink: 0; border: 1px solid #dce3db; border-radius: 7px; padding: 6px 10px; color: #44624c; background: #fcfdf9; box-shadow: 0 1px 2px #23372004; font-size: 12px; font-weight: 550; cursor: pointer; transition: background .15s, border-color .15s; }
.cap-terminal-dialog .cap-terminal-new:hover:not(:disabled) { background: #edf2e9; border-color: #cbd8c8; }
.cap-terminal-dialog .cap-terminal-icon { display: inline-flex; align-items: center; justify-content: center; width: 29px; height: 29px; padding: 0; border: 0; border-radius: 7px; color: #849087; background: transparent; cursor: pointer; }
.cap-terminal-dialog .cap-terminal-icon:hover { color: #355640; background: #e9eee5; }
.cap-terminal-dialog button:disabled { opacity: .35; cursor: default; }
.cap-terminal-dialog button:focus-visible { outline: 2px solid #83a888; outline-offset: 2px; }
.cap-terminal-body { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; }
.cap-terminal-create { display: grid; gap: 8px; padding: 4px 12px 14px; border-bottom: 1px solid var(--ct-line); }
.cap-terminal-create input { width: 100%; min-width: 0; padding: 8px 9px; border: 1px solid #dce2d6; border-radius: 7px; outline: none; background: var(--ct-surface); color: var(--ct-ink); font-size: 11px; }
.cap-terminal-create input::placeholder { color: #929b90; }
.cap-terminal-create .cap-terminal-new { justify-self: end; }
.cap-terminal-create input:focus { border-color: #84a27b; }
.cap-terminal-error { display: flex; align-items: center; gap: 14px; padding: 10px 20px; color: #a35a4c; background: #fbf0eb; font-size: 12px; overflow-wrap: anywhere; }
.cap-terminal-error > span { flex: 1; min-width: 0; }
.cap-terminal-error button { flex-shrink: 0; border: 0; border-bottom: 1px solid currentColor; padding: 0; color: inherit; background: transparent; cursor: pointer; }
.cap-terminal-layout { display: grid; grid-template-columns: 214px minmax(0, 1fr); flex: 1; min-height: 0; }
.cap-terminal-sidebar { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #f7f8f3; border-right: 1px solid var(--ct-line); }
.cap-terminal-sidebar-top { display: flex; align-items: center; flex-shrink: 0; height: 48px; padding: 8px 12px; }
.cap-terminal-sidebar-top .cap-terminal-new { width: 100%; }
.cap-terminal-list { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 8px; scrollbar-width: thin; scrollbar-color: #d5ddd2 transparent; }
.cap-terminal-item { position: relative; display: grid; grid-template-columns: 16px minmax(0, 1fr) 5px 24px; align-items: center; gap: 8px; min-height: 38px; margin: 0 0 3px; padding: 5px 6px 5px 10px; border-radius: 6px; color: #7e8b81; transition: background .15s; }
.cap-terminal-item:hover { background: #eef1e9; color: #526557; }
.cap-terminal-item.is-selected { color: #365740; background: #eaf0e5; }
.cap-terminal-item.is-selected::before { content: ''; position: absolute; top: 10px; bottom: 10px; left: 0; width: 2px; border-radius: 2px; background: #7b9a7e; }
.cap-terminal-dialog .cap-terminal-item-select, .cap-terminal-dialog .cap-terminal-rename { min-width: 0; width: 100%; height: 26px; margin: 0; padding: 2px 3px; border: 1px solid transparent; border-radius: 4px; color: inherit; background: transparent; font-size: 12px; font-weight: 500; line-height: 20px; text-align: left; }
.cap-terminal-dialog .cap-terminal-item-select { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.cap-terminal-dialog .cap-terminal-rename { outline: none; border-color: #9eb59a; background: #fcfdf9; }
.cap-terminal-dialog .cap-terminal-more { width: 24px; height: 24px; border-radius: 4px; opacity: 0; }
.cap-terminal-item:hover .cap-terminal-more, .cap-terminal-item:focus-within .cap-terminal-more, .cap-terminal-more[aria-expanded='true'] { opacity: 1; }
.cap-terminal-menu { position: fixed; inset: auto; box-sizing: border-box; width: 154px; margin: 0; padding: 5px; border: 1px solid #e0e6db; border-radius: 9px; color: #506054; background: #fcfdf9; box-shadow: 0 8px 24px #23372020, 0 2px 5px #23372008; }
.cap-terminal-menu > button { display: flex; align-items: center; gap: 9px; width: 100%; height: 31px; padding: 5px 8px; border: 0; border-radius: 5px; background: transparent; color: inherit; font: 12px/1.4 Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif; text-align: left; cursor: pointer; }
.cap-terminal-menu > button:hover:not(:disabled), .cap-terminal-menu > button:focus-visible { background: #edf2e8; outline: none; }
.cap-terminal-menu > button:disabled { opacity: .35; cursor: default; }
.cap-terminal-menu kbd { margin-left: auto; color: #97a18f; font: 10px ui-monospace, monospace; }
.cap-terminal-menu > .cap-terminal-delete { color: #a56555; }
.cap-terminal-menu > .cap-terminal-delete:hover:not(:disabled) { background: #fcf0ec; }
.cap-terminal-list > p { margin: 8px 0; padding: 12px; color: var(--ct-muted); font-size: 12px; text-align: center; }
.cap-terminal-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #131917; }
.cap-terminal-viewport { flex: 1; min-height: 0; overflow: hidden; padding: 18px 14px 18px 20px; cursor: text; }
.cap-terminal-emulator { width: 100%; height: 100%; overflow: hidden; background: #131917; }
.cap-terminal-emulator .xterm { height: 100%; padding: 0; background: #131917; }
.cap-terminal-emulator .xterm-viewport, .cap-terminal-emulator .xterm-scrollable-element, .cap-terminal-emulator .xterm-screen { background-color: #131917; }
.cap-terminal-emulator .xterm .xterm-scrollable-element > .scrollbar.horizontal { display: none; }
.cap-terminal-emulator .xterm textarea.xterm-helper-textarea { min-height: 0; min-width: 0; padding: 0; border: 0; opacity: 0; resize: none; }
.cap-terminal-empty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #718479; padding: 24px; text-align: center; }
.cap-terminal-empty strong { font-size: 14px; font-weight: 500; color: #afc1b4; }
.cap-terminal-empty p { font-size: 12px; margin: 0; }
@media (max-width: 640px) {
  .cap-terminal-dialog { width: calc(100vw - 20px); height: calc(100dvh - 32px); border-radius: 15px; }
  .cap-terminal-header { padding: 15px; gap: 8px; }
  .cap-terminal-heading { gap: 9px; }
  .cap-terminal-heading-icon { width: 33px; height: 33px; border-radius: 9px; }
  .cap-terminal-heading h2 { font-size: 14px; }
  .cap-terminal-heading p { font-size: 9px; }
  .cap-terminal-heading-copy { gap: 8px; }
  .cap-terminal-context { display: none; }
  .cap-terminal-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .cap-terminal-sidebar { max-height: 230px; border-right: 0; border-bottom: 1px solid var(--ct-line); }
  .cap-terminal-sidebar-top { height: 43px; padding: 7px 10px; }
  .cap-terminal-sidebar-top .cap-terminal-new { width: auto; }
  .cap-terminal-list { display: flex; flex: 0 0 auto; align-items: flex-start; gap: 5px; overflow-x: auto; padding: 4px 8px 8px; }
  .cap-terminal-item { flex: 0 0 170px; margin: 0; }
  .cap-terminal-dialog .cap-terminal-new { font-size: 11px; padding: 7px; }
  .cap-terminal-create { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; padding: 4px 10px 10px; }
  .cap-terminal-viewport { padding-left: 15px; }
}
@media (hover: none) { .cap-terminal-dialog .cap-terminal-more { opacity: 1; } }
`;
