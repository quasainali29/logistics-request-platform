// Shared CSV generation for the Reports section's export routes. Kept
// dependency-free (no csv library) since escaping a handful of columns
// is simple enough on its own.

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  // Leading BOM so Excel opens UTF-8 CSVs without mangling special characters.
  return "﻿" + lines.join("\r\n");
}

export function csvResponse(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const csv = rowsToCsv(headers, rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
