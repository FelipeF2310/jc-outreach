import { endpoint, tokenFrom } from "@/server/http";
import { hashToken, issueCredential, results } from "@/server/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return endpoint(request, results, true);
}
export async function POST(request: Request) {
  return endpoint(
    request,
    async (db) => {
      const state = await results(db);
      const original = state.assignments.find(
        (a) => a.name === "Practice walk",
      );
      if (!original) throw new Error("No active synthetic assignment");
      return { token: await issueCredential(db, original.id) };
    },
    true,
  );
}
export async function DELETE(request: Request) {
  return endpoint(
    request,
    async (db) => {
      await db.query(
        "UPDATE outreach.credentials SET revoked=true WHERE token_hash=$1",
        [hashToken(tokenFrom(request))],
      );
      return { revoked: true };
    },
    true,
  );
}
