import { endpoint, tokenFrom } from "@/server/http";
import { downloadAssignment } from "@/server/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return endpoint(request, (db) => downloadAssignment(db, tokenFrom(request)));
}
