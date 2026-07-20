"use client";

import { useState, useTransition, type FormEvent } from "react";
import { uploadAttachments } from "@/lib/uploadAttachment";
import { logAmcMaintenanceVisit } from "../actions";

export default function UploadReportForm({
  contractId,
  requiresCompliance,
}: {
  contractId: string;
  requiresCompliance: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const files = formData.getAll("report_files").filter((f): f is File => f instanceof File && f.size > 0);

    startTransition(async () => {
      try {
        const reportFiles = await uploadAttachments(files, `amc/${contractId}`);
        await logAmcMaintenanceVisit(contractId, {
          performed_date: String(formData.get("performed_date") ?? new Date().toISOString().slice(0, 10)),
          report_files: reportFiles,
          compliance_certificate_no: String(formData.get("compliance_certificate_no") ?? ""),
          compliance_authority: String(formData.get("compliance_authority") ?? ""),
          compliance_valid_until: String(formData.get("compliance_valid_until") ?? ""),
          notes: String(formData.get("notes") ?? ""),
        });
        form.reset();
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to upload report.");
      }
    });
  }

  return (
    <form id="upload" onSubmit={handleSubmit} className="space-y-3 border-t border-slate-200 pt-4 mt-4">
      <p className="text-xs font-semibold text-slate-500 uppercase">Log a maintenance visit</p>

      {done && (
        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
          Report uploaded — next maintenance date has been recalculated.
        </p>
      )}
      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Date performed</label>
          <input
            type="date"
            name="performed_date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Report / photos</label>
          <input type="file" name="report_files" multiple className="text-sm w-full" />
        </div>
      </div>

      {requiresCompliance && (
        <div className="grid grid-cols-3 gap-3 bg-slate-50 rounded-lg p-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Certificate no.</label>
            <input
              name="compliance_certificate_no"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Issuing authority</label>
            <input
              name="compliance_authority"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Valid until</label>
            <input
              type="date"
              name="compliance_valid_until"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs text-slate-500 mb-1">Notes</label>
        <textarea
          name="notes"
          rows={2}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Upload report for this cycle"}
      </button>
    </form>
  );
}
