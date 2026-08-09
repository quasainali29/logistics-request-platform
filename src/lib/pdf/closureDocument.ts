import { PDFDocument, PDFPage, PDFFont, rgb, StandardFonts, PDFImage } from "pdf-lib";
import { HEADER_LOGO_BASE64, FOOTER_LOGO_BASE64 } from "../letterhead";

// A single, generic PDF layout shared by all four category closure
// documents (delivery, maintenance, labor, procurement). The four category
// builders in closureDocumentCategories.ts each just describe *what* goes
// in the document (title, field labels, table columns, legacy signature
// role names) -- this file owns *how* it's drawn: page/cursor management,
// the E3 letterhead on every page, and the shared cost / photos / sign-off
// sections that are identical across categories.
//
// Kept completely separate from the existing .docx generators (deliveryNote.ts
// etc.) -- those are unchanged and still available on demand at any status.
// This is the new, PDF-only "closure record" that only exists once a
// request reaches "closed", per the approved mockup.

const PAGE_WIDTH = 612; // US Letter, points (72pt/in) -- matches the docx page size
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const HEADER_HEIGHT = 46;
const FOOTER_HEIGHT = 30;

const TEXT = rgb(0.15, 0.15, 0.15);
const MUTED = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.82, 0.82, 0.82);
const HEAD_BG = rgb(0.95, 0.95, 0.95);
const ACCENT = rgb(0.85, 0.35, 0.1);

export interface FieldRow {
  label: string;
  value: string;
}

export interface TableSpec {
  headers: string[];
  colWidths: number[]; // fractions summing to ~1, applied to CONTENT_WIDTH
  rows: string[][];
}

export interface FetchedImage {
  bytes: Uint8Array;
  format: "png" | "jpg";
}

export interface CostLine {
  category: string;
  description: string;
  amount: number;
}

export interface SignOff {
  signature: FetchedImage | null;
  signedByName: string;
  signedByRole: string;
  signedAt: string; // pre-formatted display string
}

export interface ClosureDocConfig {
  docTypeLabel: string; // e.g. "Delivery note"
  docNumberLabel: string; // e.g. "Delivery note no."
  docNumber: string;
  generatedDate: string;
  fields: FieldRow[]; // rendered as a 2-column label/value grid
  table?: TableSpec; // items / personnel table, category-specific
  remarksLabel?: string;
  remarksValue?: string;
  costLines: CostLine[];
  photos: FetchedImage[];
  signOff: SignOff | null;
  // A short confirmation sentence shown directly under the captured
  // signature -- e.g. "This is to confirm the above work has been carried
  // out...". Replaces the old pre-printed blank "Name/Date" signature
  // lines entirely, since the real signature is already captured above it.
  closingNote: string;
}

// Fetches a remote image (Supabase Storage URL) and returns bytes + a
// format pdf-lib can embed. Unsupported/failed fetches return null so the
// caller can skip that photo instead of failing the whole document --
// same "best effort" approach the .docx generators already take.
export async function fetchEmbeddableImage(url: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    const lower = url.toLowerCase();
    const isPng = lower.endsWith(".png") || contentType.includes("png");
    const isJpg =
      lower.endsWith(".jpg") || lower.endsWith(".jpeg") || contentType.includes("jpeg");
    if (!isPng && !isJpg) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, format: isPng ? "png" : "jpg" };
  } catch {
    return null;
  }
}

class Cursor {
  doc: PDFDocument;
  page!: PDFPage;
  y = 0;
  font: PDFFont;
  bold: PDFFont;
  headerImg: PDFImage;
  footerImg: PDFImage;

  private constructor(
    doc: PDFDocument,
    font: PDFFont,
    bold: PDFFont,
    headerImg: PDFImage,
    footerImg: PDFImage
  ) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.headerImg = headerImg;
    this.footerImg = footerImg;
  }

  static async create(doc: PDFDocument) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const headerImg = await doc.embedPng(Buffer.from(HEADER_LOGO_BASE64, "base64"));
    const footerImg = await doc.embedPng(Buffer.from(FOOTER_LOGO_BASE64, "base64"));
    const cursor = new Cursor(doc, font, bold, headerImg, footerImg);
    cursor.addPage();
    return cursor;
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const headerW = 160;
    const headerH = (headerW / this.headerImg.width) * this.headerImg.height;
    this.page.drawImage(this.headerImg, {
      x: (PAGE_WIDTH - headerW) / 2,
      y: PAGE_HEIGHT - MARGIN + (HEADER_HEIGHT - headerH) / 2 - 4,
      width: headerW,
      height: headerH,
    });
    const footerW = 160;
    const footerH = (footerW / this.footerImg.width) * this.footerImg.height;
    this.page.drawImage(this.footerImg, {
      x: (PAGE_WIDTH - footerW) / 2,
      y: MARGIN - FOOTER_HEIGHT + (FOOTER_HEIGHT - footerH) / 2,
      width: footerW,
      height: footerH,
    });
    this.y = PAGE_HEIGHT - MARGIN - HEADER_HEIGHT;
  }

  // Ensures at least `height` points remain before the footer band;
  // starts a fresh (still-lettered) page otherwise.
  ensure(height: number) {
    if (this.y - height < MARGIN + FOOTER_HEIGHT) {
      this.addPage();
    }
  }

  gap(amount: number) {
    this.y -= amount;
  }

  title(text: string) {
    this.ensure(28);
    this.page.drawText(text, {
      x: MARGIN,
      y: this.y,
      size: 18,
      font: this.bold,
      color: TEXT,
    });
    this.y -= 26;
  }

  sectionTitle(text: string, badge?: string) {
    this.ensure(22);
    this.page.drawText(text, { x: MARGIN, y: this.y, size: 12, font: this.bold, color: TEXT });
    if (badge) {
      const titleWidth = this.bold.widthOfTextAtSize(text, 12);
      this.page.drawText(badge, {
        x: MARGIN + titleWidth + 8,
        y: this.y,
        size: 9,
        font: this.font,
        color: ACCENT,
      });
    }
    this.y -= 8;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.5,
      color: LINE,
    });
    this.y -= 14;
  }

  fieldsGrid(fields: FieldRow[]) {
    const colW = CONTENT_WIDTH / 2;
    for (let i = 0; i < fields.length; i += 2) {
      this.ensure(18);
      const rowY = this.y;
      [fields[i], fields[i + 1]].forEach((f, idx) => {
        if (!f) return;
        const x = MARGIN + idx * colW;
        this.page.drawText(`${f.label}`, { x, y: rowY, size: 9, font: this.font, color: MUTED });
        this.page.drawText(truncate(f.value || "—", this.font, 9, colW - 10), {
          x,
          y: rowY - 12,
          size: 10,
          font: this.font,
          color: TEXT,
        });
      });
      this.y -= 32;
    }
    this.y -= 6;
  }

  table(spec: TableSpec) {
    const widths = spec.colWidths.map((f) => f * CONTENT_WIDTH);
    this.ensure(24);
    let x = MARGIN;
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - 16,
      width: CONTENT_WIDTH,
      height: 20,
      color: HEAD_BG,
    });
    spec.headers.forEach((h, i) => {
      this.page.drawText(h, { x: x + 6, y: this.y - 10, size: 9, font: this.bold, color: MUTED });
      x += widths[i];
    });
    this.y -= 20;

    spec.rows.forEach((row) => {
      this.ensure(20);
      x = MARGIN;
      row.forEach((cell, i) => {
        this.page.drawText(truncate(cell || "—", this.font, 9, widths[i] - 10), {
          x: x + 6,
          y: this.y - 10,
          size: 9,
          font: this.font,
          color: TEXT,
        });
        x += widths[i];
      });
      this.page.drawLine({
        start: { x: MARGIN, y: this.y - 16 },
        end: { x: PAGE_WIDTH - MARGIN, y: this.y - 16 },
        thickness: 0.5,
        color: LINE,
      });
      this.y -= 20;
    });
    this.y -= 10;
  }

  paragraph(label: string, value: string) {
    this.sectionTitle(label);
    this.ensure(16);
    const lines = wrap(value || "—", this.font, 10, CONTENT_WIDTH);
    lines.forEach((line) => {
      this.ensure(14);
      this.page.drawText(line, { x: MARGIN, y: this.y, size: 10, font: this.font, color: TEXT });
      this.y -= 14;
    });
    this.y -= 8;
  }

  costTable(lines: CostLine[]) {
    this.sectionTitle("Cost breakdown", "new");
    if (lines.length === 0) {
      this.ensure(14);
      this.page.drawText("No cost lines recorded.", {
        x: MARGIN,
        y: this.y,
        size: 10,
        font: this.font,
        color: MUTED,
      });
      this.y -= 20;
      return;
    }
    const total = lines.reduce((sum, l) => sum + l.amount, 0);
    this.table({
      headers: ["Category", "Description", "Amount"],
      colWidths: [0.22, 0.53, 0.25],
      rows: lines.map((l) => [l.category, l.description || "—", formatQAR(l.amount)]),
    });
    this.ensure(16);
    const totalLabel = "Total";
    const totalValue = formatQAR(total);
    this.page.drawText(totalLabel, {
      x: MARGIN + CONTENT_WIDTH * 0.75 - this.bold.widthOfTextAtSize(totalLabel, 10) - 60,
      y: this.y,
      size: 10,
      font: this.bold,
      color: TEXT,
    });
    this.page.drawText(totalValue, {
      x: PAGE_WIDTH - MARGIN - this.bold.widthOfTextAtSize(totalValue, 10),
      y: this.y,
      size: 10,
      font: this.bold,
      color: TEXT,
    });
    this.y -= 24;
  }

  photosGrid(photos: FetchedImage[]) {
    this.sectionTitle("Photos — after completion", "new");
    if (photos.length === 0) {
      this.ensure(14);
      this.page.drawText("No photos were attached.", {
        x: MARGIN,
        y: this.y,
        size: 10,
        font: this.font,
        color: MUTED,
      });
      this.y -= 20;
      return;
    }
    const perRow = 4;
    const gap = 8;
    const size = (CONTENT_WIDTH - gap * (perRow - 1)) / perRow;
    for (let i = 0; i < photos.length; i += perRow) {
      this.ensure(size + gap);
      const rowPhotos = photos.slice(i, i + perRow);
      rowPhotos.forEach((photo, idx) => {
        const x = MARGIN + idx * (size + gap);
        try {
          const img =
            photo.format === "png"
              ? this._pngCache.get(photo)
              : this._jpgCache.get(photo);
          if (img) {
            const scale = Math.min(size / img.width, size / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            this.page.drawImage(img, {
              x: x + (size - w) / 2,
              y: this.y - size + (size - h) / 2,
              width: w,
              height: h,
            });
          }
        } catch {
          // skip photo silently -- one bad image shouldn't fail the doc
        }
        this.page.drawRectangle({
          x,
          y: this.y - size,
          width: size,
          height: size,
          borderColor: LINE,
          borderWidth: 0.5,
        });
      });
      this.y -= size + gap;
    }
    this.y -= 6;
  }

  // Embedded images must be created via doc.embedPng/embedJpg before draw
  // time (both are async); pre-embed everything once up front and cache by
  // object identity so photosGrid's synchronous draw loop can look them up.
  private _pngCache = new Map<FetchedImage, PDFImage>();
  private _jpgCache = new Map<FetchedImage, PDFImage>();

  async preloadImages(photos: FetchedImage[]) {
    for (const p of photos) {
      try {
        const img =
          p.format === "png"
            ? await this.doc.embedPng(p.bytes)
            : await this.doc.embedJpg(p.bytes);
        if (p.format === "png") this._pngCache.set(p, img);
        else this._jpgCache.set(p, img);
      } catch {
        // leave uncached -- photosGrid draws just the placeholder frame
      }
    }
  }

  async signOffBlock(signOff: SignOff | null, closingNote: string) {
    this.sectionTitle("Completion sign-off", "new");
    if (!signOff) {
      this.ensure(14);
      this.page.drawText("Not yet captured.", {
        x: MARGIN,
        y: this.y,
        size: 10,
        font: this.font,
        color: MUTED,
      });
      this.y -= 20;
      this.closingNote(closingNote);
      return;
    }
    const boxH = 60;
    this.ensure(boxH + 30);
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - boxH,
      width: 220,
      height: boxH,
      borderColor: LINE,
      borderWidth: 0.5,
    });
    if (signOff.signature) {
      try {
        const img =
          signOff.signature.format === "png"
            ? await this.doc.embedPng(signOff.signature.bytes)
            : await this.doc.embedJpg(signOff.signature.bytes);
        const maxW = 200;
        const maxH = boxH - 12;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        this.page.drawImage(img, {
          x: MARGIN + (220 - w) / 2,
          y: this.y - boxH + (boxH - h) / 2,
          width: w,
          height: h,
        });
      } catch {
        // fall through -- empty signature box still shows the caption below
      }
    }
    this.y -= boxH + 14;
    const caption = `Signed by ${signOff.signedByName} (${signOff.signedByRole}) · ${signOff.signedAt}`;
    this.page.drawText(caption, { x: MARGIN, y: this.y, size: 9, font: this.font, color: MUTED });
    this.y -= 16;
    this.closingNote(closingNote);
  }

  // A short confirmation sentence directly under the sign-off -- no
  // heading, no blank Name/Date lines below it. The real signature above
  // already covers what those used to be for.
  closingNote(text: string) {
    const lines = wrap(text, this.font, 9, CONTENT_WIDTH);
    lines.forEach((line) => {
      this.ensure(12);
      this.page.drawText(line, { x: MARGIN, y: this.y, size: 9, font: this.font, color: MUTED });
      this.y -= 12;
    });
    this.y -= 8;
  }
}

function formatQAR(amount: number): string {
  return `QAR ${amount.toFixed(2)}`;
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(out + "…", size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + "…";
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderClosureDocument(config: ClosureDocConfig): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const cursor = await Cursor.create(doc);

  await cursor.preloadImages(config.photos);

  cursor.title(config.docTypeLabel.toUpperCase());
  cursor.fieldsGrid([
    { label: config.docNumberLabel, value: config.docNumber },
    { label: "Date", value: config.generatedDate },
    ...config.fields,
  ]);

  if (config.table) {
    cursor.sectionTitle(config.docTypeLabel === "Maintenance report" ? "Maintenance details" : "Items");
    cursor.table(config.table);
  }

  if (config.remarksLabel) {
    cursor.paragraph(config.remarksLabel, config.remarksValue ?? "");
  }

  cursor.costTable(config.costLines);
  cursor.photosGrid(config.photos);
  await cursor.signOffBlock(config.signOff, config.closingNote);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
