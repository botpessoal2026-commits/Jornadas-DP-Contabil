import type { NextConfig } from "next";
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
