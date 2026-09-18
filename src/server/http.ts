import { DomainError } from "../lib/contracts";
import { demoDatabase } from "./database";

export function requireDemo(request: Request, admin = false) {
  const url = new URL(request.url);
  if (
    process.env.JCO_SYNTHETIC_ONLY !== "1" ||
    process.env.VERCEL ||
    process.env.DATABASE_URL ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new DomainError(
      503,
      "The production backend is not configured. Real-data access is disabled.",
    );
  }
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new DomainError(403, "Cross-site access is not allowed.");
  const origin = request.headers.get("origin");
  // Next's internal request URL may use localhost while the browser uses 127.0.0.1.
  // Compare against the actual validated loopback Host, never a forwarded host.
  const host = request.headers.get("host") ?? url.host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host))
    throw new DomainError(403, "Invalid local host.");
  if (origin && origin !== `${url.protocol}//${host}`)
    throw new DomainError(403, "Cross-site access is not allowed.");
  if (admin && request.headers.get("x-jco-demo") !== "1")
    throw new DomainError(403, "Synthetic console access required.");
}
export const tokenFrom = (r: Request) =>
  r.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
export async function readOperation(request: Request, maxBytes = 16384) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new DomainError(415, "Expected JSON.");
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes)
    throw new DomainError(413, "Record is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError(400, "Record is missing.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DomainError(413, "Record is too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new DomainError(400, "Record is not valid JSON.");
  }
}
export async function endpoint(
  request: Request,
  work: (db: Awaited<ReturnType<typeof demoDatabase>>) => Promise<unknown>,
  admin = false,
) {
  try {
    requireDemo(request, admin);
    return Response.json(await work(await demoDatabase()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof DomainError ? error.status : 503;
    // Do not log request bodies, credentials, PII, or database errors containing parameters.
    return Response.json(
      {
        error:
          error instanceof DomainError
            ? error.message
            : "Service temporarily unavailable. Your saved work stays on this device.",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
