import type { NextConfig } from "next";
import { validatePublicSupabaseConfig } from "./src/lib/public-supabase-config";
validatePublicSupabaseConfig(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      ...["html", "zip"].map((extension) => ({
        source: `/arquivos/gerador-de-jornadas-cont-contabil.${extension}`,
        headers: [
          {
            key: "Content-Disposition",
            value: `attachment; filename="gerador-de-jornadas-cont-contabil.${extension}"`,
          },
        ],
      })),
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
