// Client-side image compression so photos never leave the browser at a
// size that could blow past Vercel's Server Action / Serverless Function
// body limits, and so Supabase Storage doesn't fill up with full-resolution
// phone-camera photos. Runs the moment a file is selected, before it's
// uploaded anywhere. Non-image files (PDFs, etc.) and images already under
// the target size pass through untouched. If anything about decoding or
// re-encoding fails (an exotic format the browser can't draw to canvas,
// for instance), the original file is returned rather than blocking the
// upload entirely -- a slightly-too-large photo that still uploads beats
// a technician stuck unable to submit.

const TARGET_BYTES = 950 * 1024; // a little headroom under the 1MB ask
const MAX_DIMENSION = 1600; // longest side, in px
const FALLBACK_DIMENSION = 1000;
const MIN_QUALITY = 0.4;

function fitDimensions(width: number, height: number, maxDim: number) {
  if (width <= maxDim && height <= maxDim) return { width, height };
  const scale = maxDim / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

async function loadDrawable(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Some formats (or browsers) can't go through createImageBitmap --
      // fall back to the <img> element path below.
    }
  }
  return loadImageElement(file);
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function compressImage(file: File): Promise<File> {
  if (!file || file.size === 0) return file;
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return file;
  if (file.size <= TARGET_BYTES) return file;

  try {
    const drawable = await loadDrawable(file);
    const sourceWidth = "naturalWidth" in drawable ? drawable.naturalWidth : drawable.width;
    const sourceHeight = "naturalHeight" in drawable ? drawable.naturalHeight : drawable.height;
    const { width, height } = fitDimensions(sourceWidth, sourceHeight, MAX_DIMENSION);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(drawable, 0, 0, width, height);

    let quality = 0.85;
    let blob = await canvasToBlob(canvas, quality);
    while (blob && blob.size > TARGET_BYTES && quality > MIN_QUALITY) {
      quality -= 0.15;
      blob = await canvasToBlob(canvas, quality);
    }

    // Quality reduction alone wasn't enough (a very large or very detailed
    // source image) -- shrink the dimensions further and try once more.
    if (blob && blob.size > TARGET_BYTES && (width > FALLBACK_DIMENSION || height > FALLBACK_DIMENSION)) {
      const smaller = fitDimensions(width, height, FALLBACK_DIMENSION);
      canvas.width = smaller.width;
      canvas.height = smaller.height;
      ctx.drawImage(drawable, 0, 0, smaller.width, smaller.height);
      blob = await canvasToBlob(canvas, 0.7);
    }

    if ("close" in drawable) drawable.close();
    if (!blob) return file;

    const newName = (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export async function compressImages(files: File[]): Promise<File[]> {
  return Promise.all(files.map((f) => compressImage(f)));
}
