export const DEFAULT_THEME_COLOR = '#48654a';

type Triple = [number, number, number];
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function normalizeThemeColor(value: unknown) {
  const match = typeof value === 'string' && /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!match) return DEFAULT_THEME_COLOR;
  const digits = match[1].toLowerCase();
  return '#' + (digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits);
}

function rgb(hex: string): Triple {
  // CSS optimizers can shorten palette tokens, e.g. #ffffff becomes #fff.
  // Normalize every input before color math, including CSS-derived references.
  const normalized = normalizeThemeColor(hex);
  return [1, 3, 5].map((start) => parseInt(normalized.slice(start, start + 2), 16) / 255) as Triple;
}

function linear(value: number) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function toLch(hex: string): Triple {
  const [r, g, b] = rgb(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const labB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, labB), Math.atan2(labB, a)];
}

function linearRgb([lightness, chroma, hue]: Triple): Triple {
  const a = chroma * Math.cos(hue), b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

function toHex([lightness, chroma, hue]: Triple) {
  // Reduce chroma at the sRGB boundary without changing the intended hue/lightness.
  let low = 0, high = chroma;
  let channels = linearRgb([lightness, chroma, hue]);
  if (channels.some((v) => v < 0 || v > 1)) {
    for (let i = 0; i < 20; i++) {
      const candidate = (low + high) / 2;
      if (linearRgb([lightness, candidate, hue]).every((v) => v >= 0 && v <= 1)) low = candidate;
      else high = candidate;
    }
    channels = linearRgb([lightness, low, hue]);
  }
  return '#' + channels.map((v) => {
    const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(clamp(srgb) * 255).toString(16).padStart(2, '0');
  }).join('');
}

function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function readableText(text: string, background: string, minimum = 4.5) {
  const a = luminance(text), b = luminance(background);
  if ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= minimum) return text;
  const target = (b + 0.05) / 0.05 >= 1.05 / (b + 0.05) ? 0 : 1;
  const [l, c, h] = toLch(text);
  let low = 0, high = 1;
  for (let i = 0; i < 20; i++) {
    const amount = (low + high) / 2;
    const value = luminance(toHex([l + (target - l) * amount, c, h]));
    if ((Math.max(value, b) + 0.05) / (Math.min(value, b) + 0.05) >= minimum) high = amount;
    else low = amount;
  }
  return toHex([l + (target - l) * high, c, h]);
}

/** Preserve the reference palette's relative OKLCH lightness, chroma and hue offsets. */
export function deriveThemePalette(reference: Record<string, string>, color: string) {
  const anchor = normalizeThemeColor(color);
  const result = { ...reference };
  if (anchor !== DEFAULT_THEME_COLOR) {
    const [baseL, baseC, baseH] = toLch(DEFAULT_THEME_COLOR);
    const [targetL, targetC, targetH] = toLch(anchor);
    // Extreme anchor colors must not collapse every surrounding surface to black/white.
    const paletteL = Math.max(0.3, Math.min(0.72, targetL));
    for (const [key, value] of Object.entries(reference)) {
      const [l, c, h] = toLch(value);
      const nextL = l < baseL ? l / baseL * paletteL : paletteL + (l - baseL) / (1 - baseL) * (1 - paletteL);
      result[key] = toHex([clamp(nextL), c * targetC / baseC, h + targetH - baseH]);
    }
    result.accent = anchor;
  }
  for (const [foreground, background] of [
    ['foreground', 'background'], ['muted', 'background'], ['muted-strong', 'background'],
    ['accent-foreground', 'accent'], ['sidebar-foreground', 'sidebar'], ['sidebar-muted', 'sidebar'],
    ['accent-strong', 'accent-soft'],
    ['sidebar-selected-foreground', 'sidebar-active'], ['button-neutral-foreground', 'button-neutral-bg'],
    ['control-hover-foreground', 'control-hover-bg'], ['selection-foreground', 'selection-bg'],
  ]) {
    if (result[foreground] && result[background]) result[foreground] = readableText(result[foreground], result[background]);
  }
  for (const [foreground, background] of [
    ['scrollbar-thumb', 'background'], ['scrollbar-thumb-hover', 'background'], ['scrollbar-thumb-active', 'background'],
    ['sidebar-scrollbar-thumb', 'sidebar'], ['sidebar-scrollbar-hover', 'sidebar'], ['sidebar-scrollbar-active', 'sidebar'],
    ['focus-ring', 'panel'],
  ]) {
    if (result[foreground] && result[background]) result[foreground] = readableText(result[foreground], result[background], 3);
  }
  return result;
}
