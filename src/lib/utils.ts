// Small shared UI helpers.

/**
 * Given a hex color (e.g. "#2563eb"), returns a readable text color
 * ("#ffffff" or "#0f172a") based on the background's relative luminance.
 * Used so admin-configurable background colors (login page, etc.) always
 * keep their heading/label text legible, whatever color is picked.
 */
export function getContrastTextColor(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#ffffff";

  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? "#0f172a" : "#ffffff";
}
