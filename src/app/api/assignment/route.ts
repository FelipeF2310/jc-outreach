import { fieldEndpoint } from "@/server/field-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return fieldEndpoint(request, "download");
}
