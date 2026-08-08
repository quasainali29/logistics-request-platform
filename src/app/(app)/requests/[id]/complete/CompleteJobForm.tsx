"use client";

import { useRef, useState, useTransition, type PointerEvent } from "react";
import { technicianCompleteJob } from "../../actions";

const SIGNER_ROLES: { value: string; label: string }[] = [
  { value: "site_supervisor", label: "Site Supervisor" },
  { value: "requestor", label: "Requestor" },
  { value: "other", label: "Other" },
];

export function CompleteJobForm({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();
  const [photos, setPhotos] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [signedByName, setSignedByName] = useState("");
  const [signedByRole, setSignedByRole] = useState("site_supervisor");
  const [hasSignature, setHasSignature] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  function canvasPoint(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = canvasPoint(e);
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !lastPointRef.current) return;
    const point = canvasPoint(e);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
    if (!hasSignature) setHasSignature(true);
  }

  function handlePointerUp() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPhotos((prev) => [...prev, ...files]);
    e.target.value = "";
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  const canSubmit = hasSignature && signedByName.trim().length > 0 && !pending;

  function handleSubmit() {
    if (!canSubmit) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const formData = new FormData();
    photos.forEach((file) => formData.append("photos", file));
    formData.append("notes", notes);
    formData.append("signed_by_name", signedByName.trim());
    formData.append("signed_by_role", signedByRole);
    formData.append("signature", canvas.toDataURL("image/png"));

    startTransition(() => {
      technicianCompleteJob(requestId, formData);
    });
  }

  return (
    <div className="space-y-5">
      {/* Photos */}
      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Photos of completed work</h2>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {photos.map((file, i) => (
            <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={URL.createObjectURL(file)}
                alt={`Photo ${i + 1}`}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                aria-label="Remove photo"
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs leading-none"
              >
                ×
              </button>
            </div>
          ))}
          <label className="aspect-square rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center text-2xl text-slate-400 cursor-pointer hover:bg-slate-50">
            ＋
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handlePhotoChange}
              className="hidden"
            />
          </label>
        </div>
        <p className="text-xs text-slate-400">Tap + to take a photo or choose from your gallery.</p>
      </section>

      {/* Notes */}
      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Work notes</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="What did you do to complete this job?"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </section>

      {/* Signature */}
      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-900">Signature</h2>
          <button
            type="button"
            onClick={clearSignature}
            className="text-xs font-medium text-[var(--accent)]"
          >
            Clear
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={600}
          height={220}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="w-full border border-slate-300 rounded-lg bg-white touch-none"
          style={{ height: 140 }}
        />
        <p className="text-xs text-slate-400 mt-2">
          Have the requestor or site supervisor sign above with their finger or a stylus.
        </p>
      </section>

      {/* Signed by */}
      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Signed by</label>
        <input
          type="text"
          value={signedByName}
          onChange={(e) => setSignedByName(e.target.value)}
          placeholder="Full name"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <div className="flex gap-2">
          {SIGNER_ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setSignedByRole(r.value)}
              className={`flex-1 text-center rounded-md py-2 text-xs font-medium transition ${
                signedByRole === r.value
                  ? "bg-[var(--accent)] text-white"
                  : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={handleSubmit}
        className="w-full rounded-md py-3 text-sm font-semibold text-white bg-[var(--accent)] hover:opacity-90 transition disabled:opacity-50"
      >
        {pending ? "Submitting…" : "Submit & Complete Job"}
      </button>
      <p className="text-center text-xs text-slate-400">
        This marks the request Completed and notifies the coordinator.
      </p>
    </div>
  );
}
