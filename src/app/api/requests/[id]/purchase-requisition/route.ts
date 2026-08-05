import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import {
  buildPurchaseRequisitionDocx,
  type PurchaseRequisitionItem,
  type SupportedImageType,
} from "@/lib/purchaseRequisition";
import { PURCHASING_CATEGORIES } from "@/lib/types";
import { format, parseISO } from "date-fns";

// Same audience as the other fulfillment docs: whoever actually handles the
// procurement (coordinators, warehouse staff, managers), not the original
// requester. Available on any procurement request regardless of status.
function canGeneratePurchaseRequisition(profile: { is_manager?: boolean; role: string }) {
  return (
    profile.is_manager ||
    profile.role === "logistics_coordinator" ||
    profile.role === "warehouse_team"
  );
}

function inferImageType(url: string, contentType: string | null): SupportedImageType {
  const lower = url.toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".gif")) return "gif";
  if (lower.endsWith(".bmp")) return "bmp";
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("gif")) return "gif";
  if (contentType?.includes("bmp")) return "bmp";
  return "jpg";
}

async function fetchImage(
  url: string
): Promise<{ buffer: Buffer; type: SupportedImageType } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const type = inferImageType(url, res.headers.get("content-type"));
    return { buffer: Buffer.from(arrayBuffer), type };
  } catch {
    return null;
  }
}

function purchasingCategoryLabel(value: string | null) {
  if (!value) return "—";
  return PURCHASING_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const profile = await getProfile();

  if (!canGeneratePurchaseRequisition(profile)) {
    return NextResponse.json(
      { error: "You don't have permission to generate purchase requisitions." },
      { status: 403 }
    );
  }

  const supabase = await createClient();

  const { data: request } = await supabase
    .from("requests")
    .select(
      "*, requestor:profiles!requests_requestor_id_fkey(full_name), approver:profiles!requests_approved_by_fkey(full_name), owner:profiles!requests_owner_id_fkey(full_name), linked_project:projects!requests_project_id_fkey(name, deleted_at)"
    )
    .eq("id", id)
    .single();

  if (!request || request.category !== "procurement") {
    return NextResponse.json({ error: "Procurement request not found." }, { status: 404 });
  }

  const [{ data: procurementDetails }, { data: items }] = await Promise.all([
    supabase.from("procurement_details").select("*").eq("request_id", id).maybeSingle(),
    supabase
      .from("procurement_line_items")
      .select("*")
      .eq("request_id", id)
      .order("item_no", { ascending: true }),
  ]);

  const itemRows = items ?? [];
  const requisitionItems: PurchaseRequisitionItem[] = await Promise.all(
    itemRows.map(async (item) => {
      const image = item.image_url ? await fetchImage(item.image_url) : null;
      return {
        itemNo: item.item_no,
        description: item.item_description ?? "—",
        quantity: item.quantity,
        purchasingLink: item.purchasing_link,
        imageBuffer: image?.buffer ?? null,
        imageType: image?.type,
      };
    })
  );

  const requestorName =
    (request.requestor as { full_name?: string } | null)?.full_name ?? "—";
  const approverName = (request.approver as { full_name?: string } | null)?.full_name ?? "—";
  const ownerName = (request.owner as { full_name?: string } | null)?.full_name ?? "—";

  // Same resolution the request detail page uses: prefer the admin-managed
  // project linked via project_id, falling back to the legacy free-text
  // `project` column only when no project_id was ever set.
  const linkedProject = request.linked_project as
    | { name: string; deleted_at: string | null }
    | null;
  const projectDisplay = linkedProject
    ? linkedProject.deleted_at
      ? "Unavailable Project"
      : linkedProject.name
    : request.project ?? "—";

  const purchasingCategory =
    procurementDetails?.purchasing_category === "other"
      ? procurementDetails.purchasing_category_other || "Other"
      : purchasingCategoryLabel(procurementDetails?.purchasing_category ?? null);

  const buffer = await buildPurchaseRequisitionDocx({
    requestNumber: request.request_number ?? "—",
    generatedDate: format(new Date(), "dd/MM/yyyy"),
    requestedBy: requestorName,
    department: request.department ?? "—",
    project: projectDisplay,
    approvedBy: approverName,
    assignedTo: ownerName,
    purchasingCategory,
    vendor: procurementDetails?.vendor ?? "—",
    neededBy: procurementDetails?.needed_by_date
      ? format(parseISO(procurementDetails.needed_by_date), "dd/MM/yyyy")
      : "—",
    items: requisitionItems,
  });

  const fileName = `Purchase-Requisition-${request.request_number ?? id}.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
