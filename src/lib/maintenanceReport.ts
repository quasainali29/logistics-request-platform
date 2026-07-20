import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  VerticalAlign,
  ShadingType,
  Header,
  Footer,
  ImageRun,
} from "docx";
import { HEADER_LOGO_BASE64, FOOTER_LOGO_BASE64 } from "./letterhead";

const PAGE_WIDTH = 12240; // US Letter, DXA
const MARGIN = 1440;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 9360

const NO_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 2, color: "D0D0D0" },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: "D0D0D0" },
  left: { style: BorderStyle.SINGLE, size: 2, color: "D0D0D0" },
  right: { style: BorderStyle.SINGLE, size: 2, color: "D0D0D0" },
};

export type SupportedImageType = "png" | "jpg" | "gif" | "bmp";

export interface MaintenancePhoto {
  buffer: Buffer;
  type: SupportedImageType;
}

export interface MaintenanceReportData {
  reportNumber: string;
  generatedDate: string;
  requestedBy: string;
  department: string;
  project: string;
  approvedBy: string;
  assignedTo: string;
  locationArea: string;
  maintenanceType: string;
  urgency: string;
  scheduled: string;
  workPermitAttached: boolean;
  photos: MaintenancePhoto[];
}

function labelCell(text: string, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 80 },
    borders: NO_BORDER,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 18, color: "666666" })],
      }),
    ],
  });
}

function valueCell(text: string, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 80, right: 120 },
    borders: NO_BORDER,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        children: [new TextRun({ text: text || " ", size: 20 })],
      }),
    ],
  });
}

function photoPlaceholderCell(width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 100, bottom: 100, left: 60, right: 60 },
    borders: NO_BORDER,
    shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "—", size: 16, color: "999999" })],
      }),
    ],
  });
}

function photoImageCell(photo: MaintenancePhoto, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    borders: NO_BORDER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: photo.buffer,
            transformation: { width: 120, height: 120 },
            type: photo.type,
          }),
        ],
      }),
    ],
  });
}

function sigCell(role: string) {
  return new TableCell({
    width: { size: CONTENT_WIDTH / 2, type: WidthType.DXA },
    margins: { top: 300, bottom: 200, left: 120, right: 120 },
    borders: NO_BORDER,
    children: [
      new Paragraph({ children: [new TextRun({ text: " " })] }),
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: "999999" } },
        spacing: { before: 400 },
        children: [new TextRun({ text: `${role}'s Signature`, bold: true, size: 18 })],
      }),
      new Paragraph({
        spacing: { before: 200 },
        children: [new TextRun({ text: "Name: ____________________", size: 18 })],
      }),
      new Paragraph({
        spacing: { before: 100 },
        children: [new TextRun({ text: "Date: ____________________", size: 18 })],
      }),
    ],
  });
}

export async function buildMaintenanceReportDocx(
  data: MaintenanceReportData
): Promise<Buffer> {
  const headerImg = Buffer.from(HEADER_LOGO_BASE64, "base64");
  const footerImg = Buffer.from(FOOTER_LOGO_BASE64, "base64");

  const headerTable = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [1800, 2880, 1800, 2880],
    rows: [
      new TableRow({
        children: [
          labelCell("Report No.", 1800),
          valueCell(data.reportNumber, 2880),
          labelCell("Date", 1800),
          valueCell(data.generatedDate, 2880),
        ],
      }),
    ],
  });

  const detailsTable = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [1800, 2880, 1800, 2880],
    rows: [
      new TableRow({
        children: [
          labelCell("Requested by", 1800),
          valueCell(data.requestedBy, 2880),
          labelCell("Location / Area", 1800),
          valueCell(data.locationArea, 2880),
        ],
      }),
      new TableRow({
        children: [
          labelCell("Department", 1800),
          valueCell(data.department, 2880),
          labelCell("Type of Maintenance", 1800),
          valueCell(data.maintenanceType, 2880),
        ],
      }),
      new TableRow({
        children: [
          labelCell("Project", 1800),
          valueCell(data.project, 2880),
          labelCell("Urgency", 1800),
          valueCell(data.urgency, 2880),
        ],
      }),
      new TableRow({
        children: [
          labelCell("Approved By", 1800),
          valueCell(data.approvedBy, 2880),
          labelCell("Scheduled", 1800),
          valueCell(data.scheduled, 2880),
        ],
      }),
      new TableRow({
        children: [
          labelCell("Assigned to", 1800),
          valueCell(data.assignedTo, 2880),
          labelCell("Work Permit", 1800),
          valueCell(data.workPermitAttached ? "Attached" : "—", 2880),
        ],
      }),
    ],
  });

  const photoColW = [1872, 1872, 1872, 1872, 1872];
  const photoRows: TableRow[] = [];
  if (data.photos.length > 0) {
    for (let i = 0; i < data.photos.length; i += 5) {
      const chunk = data.photos.slice(i, i + 5);
      const cells = chunk.map((p) => photoImageCell(p, photoColW[0]));
      while (cells.length < 5 && i + 5 >= data.photos.length) {
        // pad the last row so column widths stay even; only pad the final row
        break;
      }
      photoRows.push(new TableRow({ children: cells }));
    }
  } else {
    photoRows.push(
      new TableRow({
        children: [photoPlaceholderCell(CONTENT_WIDTH)],
      })
    );
  }

  const photosTable = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    rows: photoRows,
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: 15840 },
            margin: {
              top: 1750,
              bottom: 1500,
              left: MARGIN,
              right: MARGIN,
              header: 500,
              footer: 500,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new ImageRun({
                    data: headerImg,
                    transformation: { width: 468, height: 64 },
                    type: "png",
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new ImageRun({
                    data: footerImg,
                    transformation: { width: 468, height: 53 },
                    type: "png",
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
            children: [new TextRun({ text: "MAINTENANCE REPORT", bold: true, size: 32 })],
          }),
          headerTable,
          new Paragraph({
            spacing: { before: 240, after: 120 },
            children: [new TextRun({ text: "Maintenance Details", bold: true, size: 22 })],
          }),
          detailsTable,
          new Paragraph({
            spacing: { before: 300, after: 120 },
            children: [new TextRun({ text: "Photos", bold: true, size: 22 })],
          }),
          photosTable,
          new Paragraph({
            spacing: { before: 300, after: 80 },
            children: [new TextRun({ text: "Comments", bold: true, size: 22 })],
          }),
          new Paragraph({
            spacing: { after: 60 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" } },
            children: [new TextRun({ text: " " })],
          }),
          new Paragraph({
            spacing: { after: 60 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" } },
            children: [new TextRun({ text: " " })],
          }),
          new Paragraph({
            spacing: { after: 240 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" } },
            children: [new TextRun({ text: " " })],
          }),
          new Paragraph({
            spacing: { before: 200, after: 80 },
            children: [new TextRun({ text: "Acknowledgement", bold: true, size: 22 })],
          }),
          new Paragraph({
            spacing: { after: 300 },
            children: [
              new TextRun({
                text:
                  "This is to confirm that the above maintenance work has been carried out and inspected, unless otherwise noted above.",
                size: 20,
              }),
            ],
          }),
          new Table({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            columnWidths: [4680, 4680],
            rows: [
              new TableRow({
                children: [sigCell("Maintenance Team"), sigCell("Site Incharge")],
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
