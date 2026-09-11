export const responseUIStyles = `
.capability-response-ui {
  margin: 12px 0;
}

.capability-response-ui-card {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel) 92%, transparent);
}

.capability-response-ui-card > h3,
.capability-response-ui-card > p,
.capability-response-ui-text,
.capability-response-ui-heading {
  margin: 0;
}

.capability-response-ui-stack,
.capability-response-ui-row,
.capability-response-ui-grid {
  display: flex;
  gap: 10px;
}

.capability-response-ui-stack { flex-direction: column; }
.capability-response-ui-row { flex-flow: row wrap; align-items: center; }
.capability-response-ui-grid { display: grid; }

.capability-response-ui-badge {
  display: inline-flex;
  width: fit-content;
  padding: 3px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-size: 12px;
}

.capability-response-ui-time,
.capability-response-ui-stat {
  display: grid;
  gap: 3px;
  min-width: 140px;
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
  font-weight: 650;
}

.capability-response-ui-progress {
  display: grid;
  grid-template-columns: minmax(80px, auto) minmax(120px, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.capability-response-ui-progress progress { width: 100%; }
.capability-response-ui-divider { width: 100%; margin: 4px 0; border: 0; border-top: 1px solid var(--border); }
.capability-response-ui-key-value { display: grid; gap: 8px; margin: 0; }
.capability-response-ui-key-value > div { display: flex; justify-content: space-between; gap: 16px; }
.capability-response-ui-key-value dt { color: var(--muted); }
.capability-response-ui-key-value dd { margin: 0; font-weight: 600; }
.capability-response-ui-timeline { display: grid; gap: 8px; margin: 0; padding-left: 20px; }

`;
