import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { CATEGORY_LABELS, type Category } from "@/lib/types";
import { CompleteJobForm } from "./CompleteJobForm";

export default async function CompleteJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const profile = await getProfile();
  const supabase = await createClient();

  const [{ data: request }, { data: crewRow }] = await Promise.all([
    supabase
      .from("requests")
      .select("id, request_number, title, category, status")
      .eq("id", id)
      .single(),
    supabase
      .from("request_technicians")
      .select("technician_id")
      .eq("request_id", id)
      .eq("technician_id", profile.id)
      .maybeSingle(),
  ]);

  if (!request) notFound();

  if (!crewRow) {
    redirect(`/requests/${id}?error=${encodeURIComponent("This job isn't assigned to you.")}`);
  }

  if (request.status !== "on_site") {
    redirect(
      `/requests/${id}?error=${encodeURIComponent(
        "Start the job before marking it completed."
      )}`
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-md mx-auto p-4 pb-10">
        <div className="mb-4">
          <p className="text-xs text-slate-500 mb-1">{request.request_number}</p>
          <h1 className="text-lg font-semibold text-slate-900">Complete Job</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {CATEGORY_LABELS[request.category as Category]} · {request.title}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <CompleteJobForm requestId={id} />
      </div>
    </div>
  );
}
