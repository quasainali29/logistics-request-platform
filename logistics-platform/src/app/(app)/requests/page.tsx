import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type WorkflowStage } from "@/lib/types";
import Link from "next/link";
import RequestsTable from "./RequestsTable";

export default async function RequestsPage() {
  const profile = await getProfile();
  const supabase = await createClient();
  const isStaff = !!profile.is_staff;
  const isManager = !!profile.is_manager;

  let query = supabase
    .from("requests")
    .select("*, requestor:profiles!requests_requestor_id_fkey(full_name)");

  if (!isStaff) {
    query = query.eq("requestor_id", profile.id);
  }

  const [{ data: requests }, { data: stages }] = await Promise.all([
    query.order("created_at", { ascending: false }),
    supabase.from("workflow_stages").select("*"),
  ]);

  const stageList = (stages ?? []) as WorkflowStage[];

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Requests</h1>
          <p className="text-sm text-slate-500 mt-1">
            {isStaff ? "All requests across the team." : "Requests you've submitted."}
          </p>
        </div>
        <Link
          href="/requests/new"
          className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition"
        >
          New Request
        </Link>
      </div>

      <RequestsTable
        requests={requests ?? []}
        stageList={stageList}
        isStaff={isStaff}
        isManager={isManager}
      />
    </div>
  );
}
