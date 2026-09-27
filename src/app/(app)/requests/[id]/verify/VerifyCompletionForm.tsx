"use client";

import { useRef, useState, type PointerEvent } from "react";
import { submitVerification } from "../../actions";
import { uploadAttachment } from "@/lib/uploadAttachment";
import { compressImage } from "@/lib/compressImage";

function isNextRedirectError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

type Decision = "satisfactory" | "not_satisfactory" | null;

export function VerifyCompletionForm({ requestId }: { requestId: string }) {
  const [decision, setDecision] = useState<Decision>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [comment, setComment] = useState("");
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

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    setCompressing(true);
    try {
      const compressed = await compressImage(file);
      setPhoto(compressed);
    } finally {
      setCompressing(false);
    }
  }

  const canSubmit =
    !submitting &&
    !compressing &&
    (decision === "satisfactory"
      ? hasSignature
      : decision === "not_satisfactory"
        ? comment.trim().length > 0
        : false);

  async function handleSubmit() {
    if (!canSubmit || !decision) return;
    setSubmitError("");
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("decision", decision);

      if (photo) {
        const uploaded = await uploadAttachment(photo, `verification/${requestId}`);
        formData.append("photo_json", JSON.stringify(uploaded ? [uploaded] : []));
      }

      if (decision === "satisfactory") {
        const canvas = canvasRef.current;
        if (!canvas) return;
        formData.append("signature", canvas.toDataURL("image/png"));
      } else {
        formData.append("comment", comment.trim());
      }

      await submitVerification(requestId, formData);
      setSubmitting(false);
    } catch (err) {
      if (isNextRedirectError(err)) throw err;
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">
          Is the work done as requested?
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDecision("satisfactory")}
            className={`flex-1 rounded-md py-2.5 text-sm font-medium transition ${
              decision === "satisfactory"
                ? "bg-emerald-600 text-white"
                : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            Looks good
          </button>
          <button
            type="button"
            onClick={() => setDecision("not_satisfactory")}
            className={`flex-1 rounded-md py-2.5 text-sm font-medium transition ${
              decision === "not_satisfactory"
                ? "bg-red-600 text-white"
                : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            Not satisfactory
          </button>
        </div>
      </section>

      {decision === "satisfactory" && (
        <>
          <section className="bg-white border border-slate-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Your completion photo</h2>
            {photo ? (
              <div className="relative w-28 aspect-square rounded-lg overflow-hidden bg-slate-100 mb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(photo)}
                  alt="Completion"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  aria-label="Remove photo"
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs leading-none"
                >
                  ×
                </button>
              </div>
            ) : (
              <label className="block w-28 aspect-square rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center text-2xl text-slate-400 cursor-pointer hover:bg-slate-50">
                ＋
                <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
              </label>
            )}
            <p className="text-xs text-slate-400 mt-1">
              {compressing ? "Optimizing photo…" : "Optional, but recommended."}
            </p>
          </section>

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
              Sign above to confirm the work is done as requested.
            </p>
          </section>
        </>
      )}

      {decision === "not_satisfactory" && (
        <>
          <section className="bg-white border border-slate-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">
              What&rsquo;s pending or needs to be redone
            </h2>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="Describe what's missing or not done as requested"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Photo of the issue</h2>
            {photo ? (
              <div className="relative w-28 aspect-square rounded-lg overflow-hidden bg-slate-100 mb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(photo)}
                  alt="Issue"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  aria-label="Remove photo"
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs leading-none"
                >
                  ×
                </button>
              </div>
            ) : (
              <label className="block w-28 aspect-square rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center text-2xl text-slate-400 cursor-pointer hover:bg-slate-50">
                ＋
                <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
              </label>
            )}
            <p className="text-xs text-slate-400 mt-1">
              {compressing ? "Optimizing photo…" : "Optional."}
            </p>
          </section>
        </>
      )}

      {submitError && (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
          {submitError}
        </div>
      )}

      {decision && (
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className={`w-full rounded-md py-3 text-sm font-semibold text-white transition disabled:opacity-50 ${
            decision === "satisfactory" ? "bg-emerald-600 hover:opacity-90" : "bg-red-600 hover:opacity-90"
          }`}
        >
          {submitting
            ? "Submitting…"
            : decision === "satisfactory"
              ? "Confirm and verify"
              : "Report issue"}
        </button>
      )}
    </div>
  );
}
