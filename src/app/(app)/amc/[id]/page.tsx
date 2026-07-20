import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  amcContractStatus,
  amcDueStatus,
  frequencyLabel,
  AMC_DUE_STATUS_COLORS,
  AMC_DUE_STATUS_LABELS,
  AMC_CONTRACT_STATUS_COLORS,
  AMC_CONTRACT_STATUS_LABELS,
  type AmcContract,
  type AmcMaintenanceRecord,
} from "@/lib/types";
import { updateAmcContract } from "../actions";
import UploadReportForm from "./UploadReportForm";

export default async function AmcDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getProfile();
  const supabase = await createClient();

  const [{ data: contract }, { data: records }] = await Promise.all([
    supabase
      .from("amc_contracts")
      .select(
        "*, location:amc_locations(*), type:amc_types(*), internal_owner:profiles!amc_contracts_internal_owner_id_fkey(full_name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("amc_maintenance_records")
      .select("*, uploader:profiles!amc_maintenance_records_uploaded_by_fkey(full_name)")
      .eq("contract_id", id)
      .order("performed_date", { ascending: false }),
  ]);

  if (!contract) notFound();

  const c = contract as AmcContract;
  const history = (records ?? []) as AmcMaintenanceRecord[];
  const due = amcDueStatus(c.next_maintenance_date);
  const contractStatus = amcContractStatus(c.contract_end);
  const requiresCompliance = !!c.type?.requires_compliance;
  const updateWithId = updateAmcContract.bind(null, c.id);

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {c.location?.name ?? "—"} — {c.type?.name ?? "—"}
          </h1>
          <p className="text-sm text-slate-500 mt-1">AMC contract detail</p>
        </div>
        <div className="flex gap-2">
          <span className={`rounded-md px-3 py-1.5 text-xs ${AMC_CONTRACT_STATUS_COLORS[contractStatus]}`}>
            {AMC_CONTRACT_STATUS_LABELS[contractStatus]}
          </span>
          <span className={`rounded-md px-3 py-1.5 text-xs ${AMC_DUE_STATUS_COLORS[due]}`}>
            {AMC_DUE_STATUS_LABELS[due]}
          </span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <Section title="Contract">
          <Grid>
            <Item label="Start date" value={c.contract_start ? format(parseISO(c.contract_start), "MMM d, yyyy") : "—"} />
            <Item label="End date" value={c.contract_end ? format(parseISO(c.contract_end), "MMM d, yyyy") : "—"} />
            <Item label="Contract value" value={c.contract_value ? `${c.currency} ${c.contract_value.toLocaleString()} / year` : "—"} />
            <Item label="Payment terms" value={c.payment_terms ?? "—"} />
            <Item label="Internal owner" value={c.internal_owner?.full_name ?? "—"} />
          </Grid>
        </Section>

        <Section title="Supplier">
          <Grid>
            <Item label="Company" value={c.supplier_name} />
            <Item label="Contact person" value={c.supplier_contact_name ?? "—"} />
            <Item label="Phone" value={c.supplier_phone ?? "—"} />
            <Item label="Email" value={c.supplier_email ?? "—"} />
          </Grid>
        </Section>

        <Section title="Schedule and SLA">
          <Grid>
            <Item label="Frequency" value={frequencyLabel(c.frequency_months)} />
            <Item label="Last maintenance" value={c.last_maintenance_date ? format(parseISO(c.last_maintenance_date), "MMM d, yyyy") : "Not logged yet"} />
            <Item label="Next maintenance" value={format(parseISO(c.next_maintenance_date), "MMM d, yyyy")} />
            <Item label="SLA response time" value={c.sla_response_hours ? `${c.sla_response_hours} hrs` : "—"} />
          </Grid>
        </Section>

        {c.notes && (
          <Section title="Notes">
            <p className="text-sm text-slate-700">{c.notes}</p>
          </Section>
        )}

        <Section title="Maintenance history">
          {history.length === 0 && (
            <p className="text-sm text-slate-400">No maintenance visits logged yet.</p>
          )}
          <div className="space-y-2">
            {history.map((r) => (
              <div key={r.id} className="flex items-start justify-between text-sm border-b border-slate-100 pb-2 last:border-0">
                <div>
                  <p className="text-slate-900">{format(parseISO(r.performed_date), "MMM d, yyyy")}</p>
                  {r.compliance_certificate_no && (
                    <p className="text-xs text-slate-500">
                      Certificate {r.compliance_certificate_no}
                      {r.compliance_authority ? ` — ${r.compliance_authority}` : ""}
                      {r.compliance_valid_until
                        ? `, valid until ${format(parseISO(r.compliance_valid_until), "MMM d, yyyy")}`
                        : ""}
                    </p>
                  )}
                  {r.notes && <p className="text-xs text-slate-500">{r.notes}</p>}
                </div>
                <div className="flex gap-2 flex-wrap justify-end max-w-xs">
                  {r.report_files.length === 0 && <span className="text-xs text-slate-400">No files</span>}
                  {r.report_files.map((f, i) => (
                    <a
                      key={i}
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[var(--accent)] underline"
                    >
                      {f.name || `File ${i + 1}`}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {profile.is_staff && (
          <UploadReportForm contractId={c.id} requiresCompliance={requiresCompliance} />
        )}
      </div>

      {profile.is_staff && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-[var(--accent)] underline w-fit">
            Edit contract details
          </summary>
          <form
            action={updateWithId}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 mt-3"
          >
            <div className="grid grid-cols-2 gap-4">
              <EditField label="Supplier name">
                <input name="supplier_name" defaultValue={c.supplier_name} required className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </EditField>
              <EditField label="Supplier contact person">
                <input name="supplier_contact_name" defaultValue={c.supplier_contact_name ?? ""} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </EditField>
              <EditField label="Supplier phone">
                <input name="supplier_phone" defaultValue={c.supplier_phone ?? ""} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </EditField>
              <EditField label="Supplier email">
                <input type="email" name="supplier_email" defaultValue={c.supplier_email ?? ""} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </EditField>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <EditField label="Frequency">
                <select name="frequency_months" defaultValue={String(c.frequency_months)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="1">Monthly</option>
                  <option value="2">Every 2 months</option>
                  <option value="3">Quarterly</option>
                  <option value="6">Bi-annual</option>
                  <option value="12">Annual</option>
                </select>
              </EditField>
              <EditField label="Next maintenance date">
                <input type="date" name="next_maintenance_date" defaultValue={c.next_maintenance_date} required className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </EditField>
              <EditField label="SLA response time (hours)">
                <input type="number" min={0} name="sla_response_hours" defaultValue={c.sla_response_hours ?? ""} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </EditField>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <EditField label="Contract start">
                <input type="date" name="contract_start" defaultValue={c.contract_start ?? ""} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </EditField>
              <EditField label="Contract end">
                <input type="date" name="contract_end" defaultValue={c.contract_end ?? ""} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </EditField>
              <EditField label="Contract value">
                <input type="number" step="0.01" min={0} name="contract_value" defaultValue={c.contract_value ?? ""} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </EditField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <EditField label="Currency">
                <input name="currency" defaultValue={c.currency} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </EditField>
              <EditField label="Payment terms">
                <input name="payment_terms" defaultValue={c.payment_terms ?? ""} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </EditField>
            </div>
            <EditField label="Notes">
              <textarea name="notes" defaultValue={c.notes ?? ""} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </EditField>
            <button type="submit" className="rounded-md px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition">
              Save changes
            </button>
          </form>
        </details>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-100 first:border-0 pt-4 first:pt-0">
      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">{title}</p>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-3">{children}</div>;
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm text-slate-900">{value}</p>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">{label}</label>
      {children}
    </div>
  );
}
