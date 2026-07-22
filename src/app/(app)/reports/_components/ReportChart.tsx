"use client";

import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

export function ReportChart({
  type,
  labels,
  datasets,
  height = 220,
  indexAxis,
}: {
  type: "bar" | "doughnut";
  labels: string[];
  datasets: { label: string; data: number[]; color: string | string[] }[];
  height?: number;
  indexAxis?: "x" | "y";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();

    chartRef.current = new Chart(canvasRef.current, {
      type,
      data: {
        labels,
        datasets: datasets.map((d) => ({
          label: d.label,
          data: d.data,
          backgroundColor: d.color,
          borderRadius: type === "bar" ? 4 : undefined,
          maxBarThickness: type === "bar" ? 22 : undefined,
          borderWidth: type === "doughnut" ? 0 : undefined,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis,
        plugins: { legend: { display: false } },
        scales:
          type === "bar"
            ? {
                x: { grid: { display: indexAxis === "y" } },
                y: { grid: { display: indexAxis !== "y" }, beginAtZero: true },
              }
            : undefined,
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, JSON.stringify(labels), JSON.stringify(datasets), indexAxis]);

  return (
    <div style={{ position: "relative", height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
