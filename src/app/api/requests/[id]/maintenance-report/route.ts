import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import {
  buildMaintenanceReportDocx,
  type MaintenancePhoto,
  type SupportedImageType,
} from "@/lib/maintenanceReport";
import { format, parseISO } from "date-fns";

// Same audience as the delivery note: whoever is actually fulfilling the
// work (coordinators, warehouse staff, managers), not the original
// requester. Available on any maintenance request regardless of status.
function canGenerateMaintenanceReport(profile: { is_manager?: boolean; role: string }) {
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

  if (!canGenerateMaintenanceReport(profile)) {
    return NextResponse.json(
      { error: "You don't have permission to generate maintenance reports." },
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

  if (!request || request.category !== "maintenance") {
    return NextResponse.json({ error: "Maintenance request not found." }, { status: 404 });
  }

  const { data: maintenanceDetails } = await supabase
    .from("maintenance_details")
    .select("*")
    .eq("request_id", id)
    .maybeSingle();

  const photoFiles = maintenanceDetails?.photos ?? [];
  const fetchedPhotos: MaintenancePhoto[] = (
    await Promise.all(
      photoFiles.map(async (p: { url: string }) => {
        const image = await fetchImage(p.url);
        return image;
      })
    )
  ).filter((p): p is MaintenancePhoto => p !== null);

  const workPermitFiles = maintenanceDetails?.work_permit ?? [];

  const requestorName =
    (request.requestor as { full_name?: string } | null)?.full_name ?? "—";
  const approverName = (request.approver as { full_name?: string } | null)?.full_name ?? "—";
  const ownerName = (request.owner as { full_name?: string } | null)?.full_name ?? "—";

  const scheduled = maintenanceDetails?.scheduled_date
    ? `${format(parseISO(maintenanceDetails.scheduled_date), "dd/MM/yyyy")}${
        maintenanceDetails.scheduled_time ? ` ${maintenanceDetails.scheduled_time}` : ""
      }`
    : "—";

  const buffer = await buildMaintenanceReportDocx({
    reportNumber: request.request_number ?? "—",
    generatedDate: format(new Date(), "dd/MM/yyyy"),
    requestedBy: requestorName,
    department: request.department ?? "—",
    project: request.project ?? "—",
    approvedBy: approverName,
    assignedTo: ownerName,
    locationArea: maintenanceDetails?.location_area ?? "—",
    maintenanceType: maintenanceDetails?.maintenance_type ?? "—",
    urgency: maintenanceDetails?.urgency ?? "—",
    scheduled,
    workPermitAttached: workPermitFiles.length > 0,
    photos: fetchedPhotos,
  });

  const fileName = `Maintenance-Report-${request.request_number ?? id}.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
