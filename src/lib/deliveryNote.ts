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

export interface DeliveryNoteItem {
  itemNo: number;
  name: string;
  quantity: number;
  location: string | null;
  imageBuffer?: Buffer | null;
  imageType?: SupportedImageType;
}

export interface DeliveryNoteData {
  requestNumber: string;
  generatedDate: string;
  requestedBy: string;
  department: string;
  project: string;
  approvedBy: string;
  assignedTo: string;
  deliverTo: string;
  deliveryAddress: string;
  items: DeliveryNoteItem[];
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

export async function buildDeliveryNoteDocx(data: DeliveryNoteData): Promise<Buffer> {
  const headerImg = Buffer.from(HEADER_LOGO_BASE64, "base64");
  const footerImg = Buffer.from(FOOTER_LOGO_BASE64, "base64");

  const headerTable = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [1800, 2880, 1800, 2880],
    rows: [
      new TableRow({
        children: [
          labelCell("Delivery Note No.", 1800),
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
          labelCell("Deliver To", 1800),
          valueCell(data.deliverTo, 2880),
        ],
      }),
      new TableRow({
        children: [
          labelCell("Department", 1800),
          valueCell(data.department, 2880),
          labelCell("Delivery Address", 1800),
          valueCell(data.deliveryAddress, 2880),
        ],
      }),
      new TableRow({
        children: [
          labelCell("Project", 1800),
          valueCell(data.project, 2880),
          labelCell("Received By", 1800),
          valueCell("", 2880),
        ],
      }),
      new TableRow({
        children: [
          labelCell("Approved By", 1800),
          valueCell(data.approvedBy, 2880),
          labelCell("Date", 1800),
          valueCell("", 2880),
        ],
      }),
      new TableRow({
        children: [
          labelCell("Assigned to", 1800),
          valueCell(data.assignedTo, 2880),
          labelCell("Time of Arrival", 1800),
          valueCell("", 2880),
        ],
      }),
    ],
  });

  const itemColW = [700, 3560, 1200, 1900, 2000];

  function imageCell(item: DeliveryNoteItem) {
    if (item.imageBuffer) {
      return new TableCell({
        width: { size: itemColW[3], type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        borders: NO_BORDER,
        children: [
          new Paragraph({
            children: [
              new ImageRun({
                data: item.imageBuffer,
                transformation: { width: 70, height: 70 },
                type: item.imageType ?? "png",
              }),
            ],
          }),
        ],
      });
    }
    return new TableCell({
      width: { size: itemColW[3], type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      borders: NO_BORDER,
      children: [new Paragraph({ children: [new TextRun({ text: "—", size: 18 })] })],
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

  const itemsTable = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: itemColW,
    rows: [
      new TableRow({
        children: [
          itemHeaderCell("S/N", itemColW[0]),
          itemHeaderCell("Item", itemColW[1]),
          itemHeaderCell("Quantity", itemColW[2]),
          itemHeaderCell("Image", itemColW[3]),
          itemHeaderCell("Location", itemColW[4]),
        ],
      }),
      ...data.items.map(
        (item) =>
          new TableRow({
            children: [
              textItemCell(String(item.itemNo), itemColW[0]),
              textItemCell(item.name, itemColW[1]),
              textItemCell(String(item.quantity), itemColW[2]),
              imageCell(item),
              textItemCell(item.location || "—", itemColW[4]),
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
            children: [new TextRun({ text: "DELIVERY NOTE", bold: true, size: 32 })],
          }),
          headerTable,
          new Paragraph({
            spacing: { before: 240, after: 120 },
            children: [new TextRun({ text: "Delivery Details", bold: true, size: 22 })],
          }),
          detailsTable,
          new Paragraph({
            spacing: { before: 300, after: 120 },
            children: [new TextRun({ text: "Items", bold: true, size: 22 })],
          }),
          itemsTable,
          new Paragraph({
            spacing: { before: 300, after: 80 },
            children: [
              new TextRun({ text: "Remarks / Condition of Delivery", bold: true, size: 22 }),
            ],
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
            children: [new TextRun({ text: "Acknowledgement of Receipt", bold: true, size: 22 })],
          }),
          new Paragraph({
            spacing: { after: 300 },
            children: [
              new TextRun({
                text:
                  "This is to confirm that the above items have been delivered in good condition and accepted without discrepancy, unless otherwise noted above.",
                size: 20,
              }),
            ],
          }),
          new Table({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            columnWidths: [4680, 4680],
            rows: [new TableRow({ children: [sigCell("Driver"), sigCell("Receiver")] })],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
