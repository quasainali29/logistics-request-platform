import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Attachments are uploaded client-side directly to Supabase Storage
      // (see src/lib/uploadAttachment.ts), so Server Action bodies should
      // stay well under 1MB — this just gives a little headroom.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
