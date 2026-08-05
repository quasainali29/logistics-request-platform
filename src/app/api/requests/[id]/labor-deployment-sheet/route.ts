import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import {
  buildLaborDeploymentSheetDocx,
  type LaborDeploymentLine,
} from "@/lib/laborDeploymentSheet";
import { LABOR_TYPES, NATURE_OF_WORK_OPTIONS } from "@/lib/types";
import { format, parseISO } from "date-fns";

// Same audience as the other fulfillment docs: whoever actually deploys the
// labor (coordinators, warehouse staff, managers), not the original
// requester. Available on any labor request regardless of status.
function canGenerateLaborDeploymentSheet(profile: { is_manager?: boolean; role: string }) {
  return (
    profile.is_manager ||
    profile.role === "logistics_coordinator" ||
    profile.role === "warehouse_team"
  );
}

function personnelTypeLabel(value: string | null) {
  if (!value) return "—";
  return LABOR_TYPES.find((t) => t.value === value)?.label ?? value;
}

function natureOfWorkLabel(value: string | null) {
  if (!value) return "—";
  return NATURE_OF_WORK_OPTIONS.find((n) => n.value === value)?.label ?? value;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const profile = await getProfile();

  if (!canGenerateLaborDeploymentSheet(profile)) {
    return NextResponse.json(
      { error: "You don't have permission to generate labor deployment sheets." },
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

  if (!request || request.category !== "labor") {
    return NextResponse.json({ error: "Labor request not found." }, { status: 404 });
  }

  const { data: lines } = await supabase
    .from("labor_personnel_lines")
    .select("*")
    .eq("request_id", id);

  const deploymentLines: LaborDeploymentLine[] = (lines ?? []).map((l) => ({
    personnelType: personnelTypeLabel(l.personnel_type),
    quantity: l.quantity,
    dateFrom: l.date_from ? format(parseISO(l.date_from), "dd/MM/yyyy") : "",
    dateTo: l.date_to ? format(parseISO(l.date_to), "dd/MM/yyyy") : "",
    natureOfWork: natureOfWorkLabel(l.nature_of_work),
  }));

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

  const buffer = await buildLaborDeploymentSheetDocx({
    requestNumber: request.request_number ?? "—",
    generatedDate: format(new Date(), "dd/MM/yyyy"),
    requestedBy: requestorName,
    department: request.department ?? "—",
    project: projectDisplay,
    approvedBy: approverName,
    assignedTo: ownerName,
    dateRequired: request.date_required
      ? format(parseISO(request.date_required), "dd/MM/yyyy")
      : "—",
    concludeBy: request.conclude_date
      ? format(parseISO(request.conclude_date), "dd/MM/yyyy")
      : "—",
    lines: deploymentLines,
  });

  const fileName = `Labor-Deployment-Sheet-${request.request_number ?? id}.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
