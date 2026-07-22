import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getWorkflowStages } from "@/lib/cachedLookups";
import Link from "next/link";
import RequestsTable from "./RequestsTable";

const PAGE_SIZE = 25;

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const profile = await getProfile();
  const supabase = await createClient();
  const isStaff = !!profile.is_staff;
  const isManager = !!profile.is_manager;

  let query = supabase
    .from("requests")
    .select(
      "*, requestor:profiles!requests_requestor_id_fkey(full_name), owner:profiles!requests_owner_id_fkey(full_name)",
      { count: "exact" }
    );

  if (!isStaff) {
    query = query.eq("requestor_id", profile.id);
  }

  const [{ data: requests, count }, stageList] = await Promise.all([
    query.order("created_at", { ascending: false }).range(from, to),
    getWorkflowStages(),
  ]);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Requests</h1>
          <p className="text-sm text-slate-500 mt-1">
            {isStaff ? "All requests across the team." : "Requests you've submitted."}
            {total > 0 && (
              <span className="text-slate-400">
                {" "}
                — {total} total, showing {from + 1}–{Math.min(to + 1, total)}
              </span>
            )}
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <Link
            href={`/requests?page=${page - 1}`}
            aria-disabled={page <= 1}
            className={`text-sm rounded-md px-3 py-1.5 border ${
              page <= 1
                ? "pointer-events-none text-slate-300 border-slate-200"
                : "text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            ← Previous
          </Link>
          <p className="text-xs text-slate-500">
            Page {page} of {totalPages}
          </p>
          <Link
            href={`/requests?page=${page + 1}`}
            aria-disabled={page >= totalPages}
            className={`text-sm rounded-md px-3 py-1.5 border ${
              page >= totalPages
                ? "pointer-events-none text-slate-300 border-slate-200"
                : "text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            Next →
          </Link>
        </div>
      )}
    </div>
  );
}
