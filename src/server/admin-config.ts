import { z } from "zod";
import { DomainError } from "../lib/contracts";

export type AdminConfig = {
  origin: string;
  supabaseUrl: string;
  publishableKey: string;
  emails: string[];
  secureCookies: boolean;
};

export function adminConfig(
  env: Record<string, string | undefined> = process.env,
): AdminConfig {
  const unavailable = () =>
    new DomainError(
      503,
      "Administrator sign-in is not configured. The local practice console is separate.",
    );
  if (
    env.JCO_HOSTED_STAGE !== "synthetic-preview" ||
    env.JCO_SYNTHETIC_ONLY === "1"
  )
    throw unavailable();
  try {
    const origin = new URL(env.JCO_APP_ORIGIN ?? "");
    const supabase = new URL(env.JCO_SUPABASE_URL ?? "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (
      origin.origin !== env.JCO_APP_ORIGIN ||
      origin.username ||
      origin.password ||
      (origin.protocol !== "https:" &&
        !(local && origin.protocol === "http:" && !env.VERCEL))
    )
      throw unavailable();
    if (
      supabase.protocol !== "https:" ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(supabase.hostname) ||
      supabase.pathname !== "/" ||
      supabase.search ||
      supabase.hash ||
      supabase.username ||
      supabase.password ||
      supabase.port
    )
      throw unavailable();
    if (!env.JCO_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_"))
      throw unavailable();
    const emails = (env.JCO_ADMIN_EMAILS ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase());
    if (
      !emails.length ||
      emails.some(
        (email) => email.includes("*") || !z.email().safeParse(email).success,
      )
    )
      throw unavailable();
    return {
      origin: origin.origin,
      supabaseUrl: supabase.origin,
      publishableKey: env.JCO_SUPABASE_PUBLISHABLE_KEY,
      emails,
      secureCookies: origin.protocol === "https:",
    };
  } catch {
    throw unavailable();
  }
}

/** Fixed configured origin, not untrusted forwarded-host headers, controls CSRF. */
export function requireAdminOrigin(request: Request, config: AdminConfig) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new DomainError(403, "Cross-site access is not allowed.");
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== config.origin) ||
    (request.method !== "GET" && origin !== config.origin)
  )
    throw new DomainError(403, "A same-origin request is required.");
  if (request.headers.get("x-jco-admin") !== "1")
    throw new DomainError(403, "Administrator request required.");
}
