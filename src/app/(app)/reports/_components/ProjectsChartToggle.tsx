"use client";

import { useState } from "react";
import { ReportChart } from "./ReportChart";

export function ProjectsChartToggle({
  labels,
  completed,
  open,
}: {
  labels: string[];
  completed: number[];
  open: number[];
}) {
  const [mode, setMode] = useState<"bar" | "pie">("bar");
  const totalCompleted = completed.reduce((a, b) => a + b, 0);
  const totalOpen = open.reduce((a, b) => a + b, 0);

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-900">Completed vs open per project</h2>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setMode("bar")}
            className={`px-3 py-1 text-xs rounded-md border transition ${
              mode === "bar"
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            Bar
          </button>
          <button
            type="button"
            onClick={() => setMode("pie")}
            className={`px-3 py-1 text-xs rounded-md border transition ${
              mode === "pie"
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            Pie
          </button>
        </div>
      </div>

      {totalCompleted + totalOpen === 0 ? (
        <p className="text-sm text-slate-400">No requests linked to a project yet.</p>
      ) : mode === "bar" ? (
        <>
          <div className="flex gap-4 text-xs text-slate-500 mb-3">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" />
              Completed
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />
              Open
            </span>
          </div>
          <ReportChart
            type="bar"
            labels={labels}
            datasets={[
              { label: "Completed", data: completed, color: "#059669" },
              { label: "Open", data: open, color: "#d97706" },
            ]}
            height={260}
          />
        </>
      ) : (
        <>
          <div className="flex gap-4 text-xs text-slate-500 mb-3">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" />
              Completed ({totalCompleted})
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />
              Open ({totalOpen})
            </span>
          </div>
          <ReportChart
            type="doughnut"
            labels={["Completed", "Open"]}
            datasets={[{ label: "Total", data: [totalCompleted, totalOpen], color: ["#059669", "#d97706"] }]}
            height={260}
          />
        </>
      )}
    </section>
  );
}
