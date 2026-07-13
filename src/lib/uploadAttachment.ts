import { createClient } from "@/lib/supabase/client";
import type { AttachmentFile } from "@/lib/types";

// All request attachments (photos, permits, item reference images) are
// uploaded directly from the browser straight to Supabase Storage, rather
// than being sent through the Next.js Server Action as part of the request
// body. Server Actions on Vercel have a small body-size ceiling (1MB by
// default, and the platform itself hard-caps Serverless Function request
// bodies at 4.5MB even if that default is raised) — routing real photos
// through that path throws "Body exceeded 1 MB limit." Uploading client-side
// and only sending the resulting public URLs to the server action sidesteps
// that limit entirely.
const BUCKET = "request-attachments";

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

export async function uploadAttachment(
  file: File | null | undefined,
  folder: string
): Promise<AttachmentFile | null> {
  if (!file || file.size === 0) return null;
  const supabase = createClient();
  const path = `${folder}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${safeName(file.name || "file")}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (error) {
    throw new Error(`Failed to upload "${file.name}": ${error.message}`);
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { name: file.name || "file", url: data.publicUrl };
}

export async function uploadAttachments(
  files: (File | null | undefined)[],
  folder: string
): Promise<AttachmentFile[]> {
  const results = await Promise.all(files.map((f) => uploadAttachment(f, folder)));
  return results.filter((r): r is AttachmentFile => r !== null);
}
