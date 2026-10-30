export const responseUIStyles = `
.capability-response-ui {
  --response-line: color-mix(in srgb, var(--border, #dce5e3) 40%, transparent);
  --response-tint: color-mix(in srgb, var(--accent, #507b78) 3%, var(--panel, #fff));
  margin: 24px 0;
  min-width: 0;
  color: var(--foreground, #303e3c);
  font-family: var(--app-font-sans, system-ui, sans-serif);
  font-size: 14px;
  line-height: 1.75;
  container-type: inline-size;
  overflow-wrap: anywhere;
}

.capability-response-ui-card {
  display: grid;
  gap: 24px;
  min-width: 0;
  padding: 8px 0 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.capability-response-ui-card > h3,
.capability-response-ui-card > p,
.capability-response-ui-text,
.capability-response-ui-heading {
  margin: 0;
}

.capability-response-ui-card > h3,
.capability-response-ui-heading {
  font-size: 17px;
  font-weight: 500;
  line-height: 1.6;
  letter-spacing: 0.02em;
}

.capability-response-ui-card > p {
  color: var(--muted, #647572);
  font-size: 13px;
}

.capability-response-ui-stack,
.capability-response-ui-row,
.capability-response-ui-grid {
  display: flex;
  gap: 16px;
  min-width: 0;
}

.capability-response-ui-stack { flex-direction: column; }
.capability-response-ui-row { flex-flow: row wrap; align-items: center; }
.capability-response-ui-grid { display: grid; }
.capability-response-ui-grid > *,
.capability-response-ui-row > * { min-width: 0; }

.capability-response-ui-badge {
  display: inline-flex;
  width: fit-content;
  padding: 3px 10px;
  border: 1px solid var(--response-line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  color: var(--accent);
  font-size: 12px;
}

.capability-response-ui-time,
.capability-response-ui-stat {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.capability-response-ui-time span,
.capability-response-ui-stat span,
.capability-response-ui-stat small {
  color: var(--muted);
  font-size: 12px;
}

.capability-response-ui-time time,
.capability-response-ui-stat strong {
  font-size: 18px;
  font-weight: 500;
}

.capability-response-ui-progress {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(40px, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.capability-response-ui-progress progress { width: 100%; accent-color: var(--accent); }
.capability-response-ui-divider { width: 100%; margin: 4px 0; border: 0; border-top: 1px solid var(--response-line); }
.capability-response-ui-key-value { display: grid; gap: 14px; margin: 0; }
.capability-response-ui-key-value > div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 24px;
  padding: 0;
}
.capability-response-ui-key-value dt { color: var(--muted, #647572); font-size: 12px; line-height: 2.04; }
.capability-response-ui-key-value dd { min-width: 0; margin: 0; font-weight: 400; text-align: start; }
.capability-response-ui-timeline { display: grid; gap: 12px; margin: 0; padding-left: 20px; }

.capability-response-ui .capability-response-ui-link {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 12px;
  max-width: 100%;
  width: fit-content;
  box-sizing: border-box;
  padding: 10px 0;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--accent, #507b78) 25%, transparent);
  border-radius: 0;
  background: transparent;
  color: var(--accent-strong, #426c68);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  transition: background 160ms ease, border-color 160ms ease;
}
.capability-response-ui-link > span { min-width: 0; }
.capability-response-ui-link > svg { flex: 0 0 auto; }
.capability-response-ui .capability-response-ui-link:hover {
  background: transparent;
  border-color: var(--accent, #507b78);
}
.capability-response-ui-link:focus-visible {
  outline: 2px solid var(--focus-ring, #507b78);
  outline-offset: 4px;
}

@container (max-width: 480px) {
  .capability-response-ui-card { padding: 4px 0 8px; gap: 20px; }
  .capability-response-ui-key-value > div { grid-template-columns: 1fr; gap: 3px; }
  .capability-response-ui-grid { grid-template-columns: 1fr !important; }
}

@media (prefers-reduced-motion: reduce) {
  .capability-response-ui .capability-response-ui-link { transition: none; }
}

`;
