import type { NextConfig } from "next";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Deterministic across Next's separate server/client build workers. Never hash
// environment files, private data, uploads or generated build output.
const release = createHash("sha256");
function fingerprint(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) fingerprint(path);
    else if (entry.isFile())
      release.update(path).update("\0").update(readFileSync(path));
  }
}
fingerprint("src");
fingerprint("public");
for (const path of ["next.config.ts", "package-lock.json"])
  release.update(path).update("\0").update(readFileSync(path));

const config: NextConfig = {
  // Public, non-identifying release marker. Next inlines this same value into
  // the built client, page and route; it is not a runtime environment lookup.
  env: { NEXT_PUBLIC_JCO_RELEASE: release.digest("hex") },
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};
export default config;
