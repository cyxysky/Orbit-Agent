export const browserPreviewStyles = String.raw`
@keyframes cap-preview-connecting { to { transform: rotate(360deg); } }
@keyframes cap-preview-pulse {
  50% {
    opacity: 0.35;
  }
}

.cap-browser-preview-modal { color: var(--foreground, #283b32); font: 13px/1.5 system-ui, sans-serif; }
.cap-browser-preview-modal input { box-sizing: border-box; font: inherit; }
.cap-browser-preview-modal .cap-browser-preview-native-dialog input { width: 100%; padding: 8px 10px; border: 1px solid var(--border, #dfe4d8); border-radius: 7px; background: var(--panel, #fcfbf7); }





.cap-browser-preview-overlay {
  animation: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  overflow: hidden;
  padding: 0;
}
.cap-browser-preview-modal { min-width: 0; min-height: 0; }

.cap-browser-preview-header,
.cap-browser-preview-tabs {
  flex: 0 0 auto;
}

.cap-browser-preview-header {
  align-items: center !important;
  background: var(--panel-soft, #f4f5ee);
  border-bottom: 1px solid var(--border, #dfe4d8);
  box-sizing: border-box;
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  gap: 10px;
  justify-content: space-between !important;
  margin: 0;
  height: 46px;
  min-height: 46px;
  max-height: 46px;
  padding: 5px 12px 9px !important;
  width: 100%;
}

.cap-browser-preview-navigation { display: flex; align-items: center; flex: 0 0 auto; gap: 1px; }

.cap-browser-preview-address {
  align-items: center;
  background: var(--panel, #fcfbf7);
  border: 1px solid color-mix(in srgb, var(--foreground, #283b32) 11%, transparent);
  border-radius: 10px;
  display: flex;
  gap: 8px;
  min-height: 32px;
  padding: 0 12px;
  flex: 1 1 auto;
  min-width: 0;
}

.cap-browser-preview-address:focus-within { border-color: color-mix(in srgb, var(--accent-strong, #36583f) 50%, var(--border, #dfe4d8)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-strong, #36583f) 7%, transparent); }
.cap-browser-preview-address-hint { font: 12px ui-monospace, monospace; color: var(--muted, #849087); opacity: .55; }
.cap-browser-preview-address input.cap-browser-preview-url,
.cap-browser-preview-address input.cap-browser-preview-url:focus,
.cap-browser-preview-address input.cap-browser-preview-url:focus-visible { border: 0; outline: none; box-shadow: none; background: transparent; height: 28px; min-height: 0; padding: 0; margin: 0; width: 100%; color: var(--foreground, #283b32); }
@container (max-width: 540px) { .cap-browser-preview-metrics { display: none !important; } }

.cap-browser-preview-address > svg {
  color: var(--muted, #849087);
  flex-shrink: 0;
}

.cap-browser-preview-title-row {
  align-items: center;
  display: flex;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.cap-browser-preview-title-row :is([data-slot="heading"], h2) {
  color: var(--foreground, #283b32);
  flex: 0 0 auto;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.3;
  margin: 0;
}

.cap-browser-preview-close {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 8px;
  color: var(--muted, #849087);
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto;
  height: 30px;
  justify-content: center;
  padding: 0;
  width: 30px;
}

.cap-browser-preview-close:hover {
  background: color-mix(in srgb, var(--foreground, #283b32) 7%, transparent);
  color: var(--foreground, #283b32);
}

.cap-browser-preview-url {
  color: var(--muted, #849087);
  flex: 1 1 auto;
  font-size: 12px;
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cap-browser-preview-metrics {
  color: var(--muted, #849087);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 88px;
  width: 88px;
  box-sizing: border-box;
  justify-content: center;
  height: 28px;
  padding: 0 8px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--foreground, #283b32) 3%, transparent);
  text-align: center;
  overflow: hidden;
  font-family: inherit;
  font-size: 12px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cap-browser-preview-metrics > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cap-browser-preview-metrics[data-status="live"] > span { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }
.cap-browser-preview-connection-spinner { flex: 0 0 11px; animation: cap-preview-connecting 1.2s linear infinite; }
@media (prefers-reduced-motion: reduce) { .cap-browser-preview-connection-spinner { animation: none; } }
.cap-browser-preview-metrics > i { flex: 0 0 5px; height: 5px; border-radius: 50%; background: var(--muted, #849087); }
.cap-browser-preview-metrics[data-status="live"] > i { background: var(--accent, #476b51); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #476b51) 9%, transparent); }

.cap-browser-preview-status {
  align-items: center;
  color: var(--muted, #849087);
  display: inline-flex;
  font-size: 12px;
  font-weight: 650;
  gap: 6px;
}

.cap-browser-preview-status>span {
  background: #94a3b8;
  border-radius: 999px;
  height: 7px;
  width: 7px;
}

.cap-browser-preview-status.is-live > span {
  background: var(--accent-strong, #36583f);
}

.cap-browser-preview-status:is(.is-connecting, .is-reconnecting) > span {
  animation: cap-preview-pulse 1.2s ease-in-out infinite;
  background: #3b82f6;
}

.cap-browser-preview-tabs button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cap-browser-preview-body {
  background: #111318;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.cap-browser-preview-stage {
  align-items: center;
  color: #cbd5e1;
  display: flex;
  height: 100%;
  justify-content: center;
  min-height: 0;
  outline: none;
  overflow: hidden;
  position: relative;
  touch-action: none;
  user-select: none;
  width: 100%;
}

.cap-browser-preview-stage.has-frame {
  cursor: default;
}

.cap-browser-preview-stage:focus-visible {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent-strong, #36583f) 72%, transparent);
}

.cap-browser-preview-stage img,
.cap-browser-preview-stage video {
  background: #111318;
  contain: paint;
  display: block;
  height: 100%;
  object-fit: contain;
  object-position: center;
  pointer-events: none;
  width: 100%;
}

.cap-browser-preview-stage video {
  inset: 0;
  opacity: 1;
  position: absolute;
  transition: opacity 120ms ease;
}

.cap-browser-preview-stage video.is-loading {
  opacity: 0;
}

.cap-browser-preview-stage img {
  image-rendering: auto;
}

.cap-browser-preview-native-select {
  background: var(--panel, #fcfbf7);
  border: 1px solid var(--border-strong, #bac8b8);
  border-radius: 10px;
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.34);
  box-sizing: border-box;
  color: var(--foreground, #283b32);
  display: grid;
  max-height: min(320px, 62%);
  max-width: calc(100% - 16px);
  overflow-x: hidden;
  overflow-y: auto;
  padding: 5px;
  position: absolute;
  z-index: 4;
}

.cap-browser-preview-native-select button {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 7px;
  color: var(--foreground, #283b32);
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 2px 8px;
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 36px;
  padding: 7px 10px;
  text-align: left;
  width: 100%;
}

.cap-browser-preview-native-select button:hover,
.cap-browser-preview-native-select button:focus-visible,
.cap-browser-preview-native-select button.is-selected {
  background: var(--panel-warm, #f6f5ee);
  outline: none;
}

.cap-browser-preview-native-select button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.cap-browser-preview-native-select button > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cap-browser-preview-native-select button small {
  color: var(--muted, #849087);
  font-size: 11px;
  grid-column: 1;
}

.cap-browser-preview-native-select button svg {
  color: var(--accent-strong, #36583f);
  grid-column: 2;
  grid-row: 1 / span 2;
}

.cap-browser-preview-native-control-form {
  display: grid;
  gap: 10px;
  padding: 8px;
}

.cap-browser-preview-native-control-form > strong {
  color: var(--foreground, #283b32);
  font-size: 13px;
}

.cap-browser-preview-native-control-form > span {
  color: var(--muted, #849087);
  font-size: 12px;
}

.cap-browser-preview-native-control-form > input:not([type='file']) {
  background: var(--panel, #fcfbf7);
  border: 1px solid var(--border-strong, #bac8b8);
  border-radius: 7px;
  box-sizing: border-box;
  color: var(--foreground, #283b32);
  font: inherit;
  min-height: 38px;
  padding: 6px 8px;
  width: 100%;
}

.cap-browser-preview-native-file-input {
  display: none;
}

.cap-browser-preview-native-control-actions,
.cap-browser-preview-native-dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.cap-browser-preview-native-control-actions button,
.cap-browser-preview-native-dialog-actions button {
  align-items: center;
  background: var(--button-neutral-bg, #f5f6f0);
  border: 1px solid var(--button-neutral-border, #dfe4d8);
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
  justify-content: center;
  min-height: 34px;
  padding: 6px 12px;
  width: auto;
}

.cap-browser-preview-native-control-actions button.is-primary,
.cap-browser-preview-native-dialog-actions button.is-primary {
  background: var(--button-primary-bg, #476b51);
  border-color: var(--button-primary-bg, #476b51);
  color: var(--button-primary-foreground, #fff);
}

.cap-browser-preview-native-dialog-backdrop {
  align-items: center;
  background: rgba(0, 0, 0, 0.36);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 20px;
  position: absolute;
  z-index: 5;
}

.cap-browser-preview-native-dialog-backdrop > section {
  background: var(--panel, #fcfbf7);
  border: 1px solid var(--border-strong, #bac8b8);
  border-radius: 12px;
  box-shadow: 0 22px 64px rgba(0, 0, 0, 0.38);
  color: var(--foreground, #283b32);
  display: grid;
  gap: 14px;
  max-width: 460px;
  padding: 18px;
  width: min(100%, 460px);
}

.cap-browser-preview-native-dialog-backdrop p {
  color: var(--foreground, #283b32);
  line-height: 1.55;
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.cap-browser-preview-empty {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 9px;
  max-width: 420px;
  padding: 28px;
  text-align: center;
}

.cap-browser-preview-empty strong {
  color: #f1f5f9;
  font-size: 14px;
}

.cap-browser-preview-empty span {
  color: #94a3b8;
  font-size: 12px;
}

.cap-browser-preview-alert {
  background: color-mix(in srgb, #991b1b 88%, transparent);
  border-radius: 8px;
  bottom: 12px;
  color: #ffffff;
  font-size: 12px;
  left: 50%;
  max-width: min(88%, 720px);
  padding: 8px 11px;
  position: absolute;
  transform: translateX(-50%);
  z-index: 2;
}

.cap-browser-preview-alert+.cap-browser-preview-alert {
  bottom: 52px;
}

.cap-browser-preview-download-notice {
  align-items: center;
  background: color-mix(in srgb, var(--panel-elevated, #fff) 96%, transparent);
  border: 1px solid var(--border-strong, #bac8b8);
  border-radius: 9px;
  bottom: 12px;
  box-shadow: var(--shadow-tight, 0 3px 12px #182d2214);
  color: var(--foreground, #283b32);
  display: flex;
  font-size: 12px;
  gap: 8px;
  left: 50%;
  max-width: min(88%, 720px);
  padding: 8px 10px;
  position: absolute;
  transform: translateX(-50%);
  z-index: 3;
}

.cap-browser-preview-download-notice span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cap-browser-preview-download-notice button {
  background: transparent;
  border: 0;
  color: var(--accent-strong, #36583f);
  cursor: pointer;
  flex: 0 0 auto;
  font: inherit;
  font-weight: 700;
  padding: 0;
}

.cap-browser-preview-download-notice .cap-browser-preview-download-dismiss {
  align-items: center;
  color: var(--muted, #849087);
  display: inline-flex;
  justify-content: center;
  margin-left: 2px;
}

.cap-browser-preview-body:has(.cap-browser-preview-download-notice) .cap-browser-preview-alert {
  bottom: 54px;
}

.cap-browser-preview-body:has(.cap-browser-preview-download-notice) .cap-browser-preview-alert+.cap-browser-preview-alert {
  bottom: 96px;
}


.cap-browser-preview-chrome { flex: 0 0 auto; background: var(--panel-soft, #f4f5ee); container-type: inline-size; }
.cap-browser-preview-tabs {
  align-items: center;
  border-bottom: 0;
  display: flex;
  gap: 8px;
  min-height: 42px;
  min-width: 0;
  padding: 7px 12px 3px;
  background: var(--panel-soft, #f4f5ee);
  border-bottom-color: var(--border, #dfe4d8);
}

.cap-browser-preview-tab-select {
  align-items: center;
  background: transparent;
  border: 0;
  cursor: pointer;
  display: inline-flex;
  flex: 1 1 auto;
  font-size: 12px;
  gap: 6px;
  min-height: 28px;
  min-width: 0;
  padding: 0 9px;
  border-radius: var(--app-radius-sm, 7px);
  color: var(--muted, #849087);
  font-weight: 500;
}

.cap-browser-preview-tab.active {
  background: var(--panel, #fcfbf7);
  border: 1px solid var(--border, #dfe4d8);
  box-shadow: var(--shadow-xs, 0 1px 3px #182d220d);
  color: var(--foreground, #283b32);
}

.cap-browser-preview-tab-list { display: flex; gap: 5px; min-width: 0; overflow-x: auto; scrollbar-width: thin; }
.cap-browser-preview-tab { display: flex; align-items: center; flex: 0 1 200px; min-width: 115px; max-width: 220px; height: 30px; border: 1px solid transparent; border-radius: 9px; padding-right: 4px; }
.cap-browser-preview-empty-tab { display: flex; gap: 7px; align-items: center; height: 28px; padding: 0 9px; color: var(--muted, #849087); font-size: 11px; }
.cap-browser-preview-tab-select > svg { flex-shrink: 0; opacity: .7; }
.cap-browser-preview-tab.active .cap-browser-preview-tab-select { color: var(--foreground, #283b32); }
.cap-browser-preview-tab:hover { background: color-mix(in srgb, var(--foreground, #283b32) 5%, transparent); }
.cap-browser-preview-icon-button,
.cap-browser-preview-tab-close { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 7px; color: var(--muted, #849087); background: transparent; cursor: pointer; }
.cap-browser-preview-tab-close { width: 22px; height: 22px; }
.cap-browser-preview-icon-button:hover,
.cap-browser-preview-tab-close:hover { color: var(--foreground, #283b32); background: color-mix(in srgb, var(--foreground, #283b32) 9%, transparent); }
.cap-browser-preview-icon-button:disabled { opacity: .35; cursor: default; background: transparent; }
.cap-browser-preview-tab:not(.active) .cap-browser-preview-tab-close { opacity: 0; }
.cap-browser-preview-tab:hover .cap-browser-preview-tab-close,
.cap-browser-preview-tab:focus-within .cap-browser-preview-tab-close { opacity: 1; }
@media (hover: none) { .cap-browser-preview-tab:not(.active) .cap-browser-preview-tab-close { opacity: 1; } }
.cap-browser-preview-icon-button:focus-visible,
.cap-browser-preview-tab-close:focus-visible,
.cap-browser-preview-tab-select:focus-visible { outline: 2px solid var(--accent-strong, #36583f); outline-offset: -2px; }

@media (max-width: 680px) {

  .ui-modal:not(.cap-browser-preview-modal) {
    border-bottom: 0;
    border-radius: var(--modal-radius, 14px) var(--modal-radius, 14px) 0 0;
    max-height: min(92dvh, 860px);
    width: 100%;
  }
}




.cap-browser-preview-alert {
  background: color-mix(in srgb, var(--danger, #b25e55) 9%, var(--panel, #fcfbf7));
  border: 1px solid color-mix(in srgb, var(--danger, #b25e55) 22%, var(--border, #dfe4d8));
  border-radius: var(--app-radius-sm, 7px);
  color: var(--danger, #b25e55);
  font-size: 12px;
}

`;
