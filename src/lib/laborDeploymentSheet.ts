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

export interface LaborDeploymentLine {
  personnelType: string;
  quantity: number;
  dateFrom: string;
  dateTo: string;
  natureOfWork: string;
}

export interface LaborDeploymentSheetData {
  requestNumber: string;
  generatedDate: string;
  requestedBy: string;
  department: string;
  project: string;
  approvedBy: string;
  assignedTo: string;
  dateRequired: string;
  concludeBy: string;
  lines: LaborDeploymentLine[];
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

function itemHeaderCell(text: string, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: "F2F2F2" },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    borders: NO_BORDER,
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 16, color: "666666" })],
      }),
    ],
  });
}

function textItemCell(text: string, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    borders: NO_BORDER,
    children: [new Paragraph({ children: [new TextRun({ text, size: 18 })] })],
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

const lineColW = [2000, 1200, 2000, 2000, 2160];

export async function buildLaborDeploymentSheetDocx(
  data: LaborDeploymentSheetData
): Promise<Buffer> {
  const headerImg = Buffer.from(HEADER_LOGO_BASE64, "base64");
  const footerImg = Buffer.from(FOOTER_LOGO_BASE64, "base64");

  const headerTable = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [1800, 2880, 1800, 2880],
    rows: [
      new TableRow({
        children: [
          labelCell("Request No.", 1800),
          valueCell(data.requestNumber, 2880),
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
          labelCell("Date Required", 1800),
          valueCell(data.dateRequired, 2880),
        ],
      }),
      new TableRow({
        children: [
          labelCell("Department", 1800),
          valueCell(data.department, 2880),
          labelCell("Conclude By", 1800),
          valueCell(data.concludeBy, 2880),
        ],
      }),
      new TableRow({
        children: [
          labelCell("Project", 1800),
          valueCell(data.project, 2880),
          labelCell("Assigned to", 1800),
          valueCell(data.assignedTo, 2880),
        ],
      }),
      new TableRow({
        children: [
          labelCell("Approved By", 1800),
          valueCell(data.approvedBy, 2880),
          labelCell("", 1800),
          valueCell("", 2880),
        ],
      }),
    ],
  });

  const linesTable = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: lineColW,
    rows: [
      new TableRow({
        children: [
          itemHeaderCell("Type of Labor", lineColW[0]),
          itemHeaderCell("Quantity", lineColW[1]),
          itemHeaderCell("From", lineColW[2]),
          itemHeaderCell("To", lineColW[3]),
          itemHeaderCell("Nature of Work", lineColW[4]),
        ],
      }),
      ...data.lines.map(
        (line) =>
          new TableRow({
            children: [
              textItemCell(line.personnelType, lineColW[0]),
              textItemCell(String(line.quantity), lineColW[1]),
              textItemCell(line.dateFrom || "—", lineColW[2]),
              textItemCell(line.dateTo || "—", lineColW[3]),
              textItemCell(line.natureOfWork || "—", lineColW[4]),
            ],
          })
      ),
    ],
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
            children: [new TextRun({ text: "LABOR DEPLOYMENT SHEET", bold: true, size: 32 })],
          }),
          headerTable,
          new Paragraph({
            spacing: { before: 240, after: 120 },
            children: [new TextRun({ text: "Labor Details", bold: true, size: 22 })],
          }),
          detailsTable,
          new Paragraph({
            spacing: { before: 300, after: 120 },
            children: [new TextRun({ text: "Personnel", bold: true, size: 22 })],
          }),
          linesTable,
          new Paragraph({
            spacing: { before: 300, after: 80 },
            children: [new TextRun({ text: "Remarks", bold: true, size: 22 })],
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
                  "This is to confirm that the above labor personnel have been deployed and the work has been carried out as instructed, unless otherwise noted above.",
                size: 20,
              }),
            ],
          }),
          new Table({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            columnWidths: [4680, 4680],
            rows: [
              new TableRow({
                children: [sigCell("Labor Team"), sigCell("Site Incharge")],
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
