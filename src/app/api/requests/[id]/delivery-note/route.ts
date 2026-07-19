import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { buildDeliveryNoteDocx, type DeliveryNoteItem, type SupportedImageType } from "@/lib/deliveryNote";
import { format } from "date-fns";

// Delivery notes are generated on demand for whoever is actually fulfilling
// the delivery — coordinators, warehouse staff, and managers — not the
// original requester. Available on any delivery request regardless of
// status; it always reflects whatever is on the request right now.
function canGenerateDeliveryNote(profile: { is_manager?: boolean; role: string }) {
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const profile = await getProfile();

  if (!canGenerateDeliveryNote(profile)) {
    return NextResponse.json(
      { error: "You don't have permission to generate delivery notes." },
      { status: 403 }
    );
  }

  const supabase = await createClient();

  const { data: request } = await supabase
    .from("requests")
    .select(
      "*, requestor:profiles!requests_requestor_id_fkey(full_name), approver:profiles!requests_approved_by_fkey(full_name), owner:profiles!requests_owner_id_fkey(full_name)"
    )
    .eq("id", id)
    .single();

  if (!request || request.category !== "delivery") {
    return NextResponse.json({ error: "Delivery request not found." }, { status: 404 });
  }

  const [{ data: deliveryDetails }, { data: items }] = await Promise.all([
    supabase.from("delivery_details").select("*").eq("request_id", id).maybeSingle(),
    supabase
      .from("delivery_items")
      .select("*")
      .eq("request_id", id)
      .order("item_no", { ascending: true }),
  ]);

  const itemRows = items ?? [];
  const deliveryNoteItems: DeliveryNoteItem[] = await Promise.all(
    itemRows.map(async (item) => {
      const image = item.image_url ? await fetchImage(item.image_url) : null;
      return {
        itemNo: item.item_no,
        name: item.item_name,
        quantity: item.required_quantity,
        location: item.current_location,
        imageBuffer: image?.buffer ?? null,
        imageType: image?.type,
      };
    })
  );

  const requestorName =
    (request.requestor as { full_name?: string } | null)?.full_name ?? "—";
  const approverName = (request.approver as { full_name?: string } | null)?.full_name ?? "—";
  const ownerName = (request.owner as { full_name?: string } | null)?.full_name ?? "—";

  const buffer = await buildDeliveryNoteDocx({
    requestNumber: request.request_number ?? "—",
    generatedDate: format(new Date(), "dd/MM/yyyy"),
    requestedBy: requestorName,
    department: request.department ?? "—",
    project: request.project ?? "—",
    approvedBy: approverName,
    assignedTo: ownerName,
    deliverTo: request.project ?? "—",
    deliveryAddress: deliveryDetails?.delivery_location ?? "—",
    items: deliveryNoteItems,
  });

  const fileName = `Delivery-Note-${request.request_number ?? id}.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
