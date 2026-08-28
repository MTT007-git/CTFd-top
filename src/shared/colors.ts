/**
 * Replica of `colorHash` from `@ctfdio/ctfd-js`, which CTFd uses to color the
 * Top-10 score graph. CTFd 3.5+ dropped the `color` field from the scoreboard
 * API, so deriving it locally is the only way to match the site's own colors —
 * and it keeps a player's color stable across pages and sessions.
 */
export function colorHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  const h = ((hash % 360) + 360) % 360;
  const s = (((hash % 25) + 25) % 25) + 75;
  const l = (((hash % 20) + 20) % 20) + 40;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** CTFd keys the graph colors on name + account id. */
export function playerColor(name: string, id: number): string {
  return colorHash(`${name}${id}`);
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lum - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/** Understands `#rgb`, `#rrggbb` and `hsl(h, s%, l%)`; anything else is treated as mid grey. */
function parseColor(color: string): Rgb {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3) {
      return {
        r: parseInt(digits[0] + digits[0], 16),
        g: parseInt(digits[1] + digits[1], 16),
        b: parseInt(digits[2] + digits[2], 16),
      };
    }
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
    };
  }
  const hsl = /^hsl\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i.exec(value);
  if (hsl) {
    return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  }
  return { r: 128, g: 128, b: 128 };
}

/**
 * Pick readable text for a generated background so both light and dark CTFd
 * themes look right.
 */
export function contrastColor(background: string): string {
  const { r, g, b } = parseColor(background);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 140 ? "#111111" : "#ffffff";
}

/**
 * Red (fewest solves) to green (most solves) across the challenges currently on
 * the page.
 */
export function solveCountColor(count: number, min: number, max: number): string {
  if (max <= min) return count > 0 ? "hsl(120 70% 40%)" : "hsl(0 70% 40%)";
  const ratio = (count - min) / (max - min);
  const hue = Math.min(120, Math.max(0, Math.round(120 * ratio)));
  return `hsl(${hue} 70% 40%)`;
}
