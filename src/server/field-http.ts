import { DomainError } from "../lib/contracts";
import { adminConfig } from "./admin-config";
import { endpoint, readOperation, tokenFrom } from "./http";
import {
  downloadAssignment,
  submitOperation,
  submitCompletion,
} from "./service";
import {
  downloadHostedAssignment,
  submitHostedOperation,
  submitHostedCompletion,
} from "./hosted-field";
import { hostedDatabase } from "./postgres";

export async function fieldEndpoint(
  request: Request,
  action: "download" | "submit" | "completion",
) {
  if (process.env.JCO_SYNTHETIC_ONLY === "1")
    return endpoint(request, async (db) =>
      action === "download"
        ? downloadAssignment(db, tokenFrom(request))
        : action === "completion"
          ? submitCompletion(
              db,
              tokenFrom(request),
              await readOperation(request, 180000),
            )
          : submitOperation(
              db,
              tokenFrom(request),
              await readOperation(request),
            ),
    );
  try {
    const config = adminConfig();
    const origin = request.headers.get("origin");
    if (
      request.headers.get("sec-fetch-site") === "cross-site" ||
      (origin && origin !== config.origin) ||
      (action !== "download" && origin !== config.origin)
    )
      throw new DomainError(403, "A same-origin request is required.");
    const token = tokenFrom(request);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new DomainError(
        401,
        "Assignment link is invalid. Contact your organizer.",
      );
    const result =
      action === "download"
        ? await downloadHostedAssignment(hostedDatabase(), token)
        : action === "completion"
          ? await submitHostedCompletion(
              hostedDatabase(),
              token,
              await readOperation(request, 180000),
            )
          : await submitHostedOperation(
              hostedDatabase(),
              token,
              await readOperation(request),
            );
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof DomainError
            ? error.message
            : "Service temporarily unavailable. Your saved work stays on this device.",
      },
      {
        status: error instanceof DomainError ? error.status : 503,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Authorization",
        },
      },
    );
  }
}
