export type TerminalGeometry = { cols: number; rows: number };

const geometryPayload = /^orbit;resize;([1-9]\d{0,2});([1-9]\d{0,2})$/;
const geometryMarkers = () => /\x1b\]777;(orbit;resize;[0-9]+;[0-9]+)(?:\x07|\x1b\\)/g;

export function parseTerminalGeometry(payload: string): TerminalGeometry | undefined {
  const match = geometryPayload.exec(payload);
  if (!match) return;
  const cols = Number(match[1]), rows = Number(match[2]);
  if (cols < 20 || cols > 500 || rows < 5 || rows > 200) return;
  return { cols, rows };
}

export function terminalGeometrySequence(geometry: TerminalGeometry): string {
  const payload = `orbit;resize;${geometry.cols};${geometry.rows}`;
  if (!parseTerminalGeometry(payload)) throw new RangeError('Invalid terminal geometry.');
  return `\x1b]777;${payload}\x07`;
}

/** Keep geometry out of the VT parser so it cannot interrupt a split sequence. */
export function splitTerminalOutput(output: string): Array<{ output: string } | { geometry: TerminalGeometry }> {
  const parts: Array<{ output: string } | { geometry: TerminalGeometry }> = [];
  let start = 0;
  for (const marker of output.matchAll(geometryMarkers())) {
    const geometry = parseTerminalGeometry(marker[1]);
    if (!geometry) continue;
    if (marker.index > start) parts.push({ output: output.slice(start, marker.index) });
    parts.push({ geometry });
    start = marker.index + marker[0].length;
  }
  if (start < output.length) parts.push({ output: output.slice(start) });
  return parts;
}

/** Geometry at a raw output offset, before parsing the remaining output. */
export function terminalGeometryAt(output: string, geometry: TerminalGeometry, offset: number): TerminalGeometry {
  const end = Math.max(0, Math.min(output.length, Number.isNaN(offset) ? 0 : Math.floor(offset)));
  for (const marker of output.matchAll(geometryMarkers())) {
    if (marker.index + marker[0].length > end) break;
    const next = parseTerminalGeometry(marker[1]);
    if (next) geometry = next;
  }
  return geometry;
}

/** Retain a raw tail and the geometry needed to replay its first character. */
export function retainTerminalOutput(
  retained: { output: string; geometry: TerminalGeometry }, chunk: string, limit: number,
): { output: string; geometry: TerminalGeometry } {
  if (!Number.isFinite(limit) || limit < 0) throw new RangeError('Invalid terminal output limit.');
  const output = retained.output + chunk;
  let cut = Math.max(0, output.length - Math.floor(limit));
  let geometry = retained.geometry;
  if (cut) {
    for (const marker of output.matchAll(geometryMarkers())) {
      if (marker.index >= cut) break;
      const next = parseTerminalGeometry(marker[1]);
      if (!next) continue;
      // A partial marker cannot be replayed. Its remaining bytes are also
      // discarded; callers derive the actual start cursor from output.length.
      geometry = next;
      cut = Math.max(cut, marker.index + marker[0].length);
    }
  }
  return { output: output.slice(cut), geometry };
}
