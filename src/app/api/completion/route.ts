import { fieldEndpoint } from "@/server/field-http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return fieldEndpoint(request, "completion");
}
