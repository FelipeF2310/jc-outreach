import { endpoint, readOperation, tokenFrom } from "@/server/http";
import { submitOperation } from "@/server/service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(request, async (db) =>
    submitOperation(db, tokenFrom(request), await readOperation(request)),
  );
}
