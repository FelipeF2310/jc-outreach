import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DomainError } from "../lib/contracts";
import {
  adminConfig,
  requireAdminOrigin,
  type AdminConfig,
} from "./admin-config";
import { readOperation } from "./http";

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const sendSchema = z.object({ email: emailSchema }).strict();
const verifySchema = z
  .object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) })
  .strict();
const cookieName = "jco-admin-session";
const cookieMatches = (name: string) =>
  name === cookieName ||
  name.startsWith(`${cookieName}.`) ||
  name === `${cookieName}-code-verifier`;

export function adminAuthContext(
  request: NextRequest,
  config: AdminConfig,
  fetcher?: typeof fetch,
) {
  const pending = new Map<string, { value: string; options: CookieOptions }>();
  const extraHeaders = new Headers();
  const client = createServerClient(config.supabaseUrl, config.publishableKey, {
    ...(fetcher ? { global: { fetch: fetcher } } : {}),
    cookieOptions: {
      name: cookieName,
      path: "/api/admin",
      httpOnly: true,
      sameSite: "strict",
      secure: config.secureCookies,
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies, headers) {
        for (const { name, value, options } of cookies)
          pending.set(name, { value, options });
        for (const [key, value] of Object.entries(headers))
          extraHeaders.set(key, value);
      },
    },
  });
  const clear = () => {
    for (const name of new Set([
      ...request.cookies.getAll().map((c) => c.name),
      ...pending.keys(),
    ])) {
      if (cookieMatches(name))
        pending.set(name, { value: "", options: { maxAge: 0 } });
    }
  };
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status, headers: extraHeaders });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Vary", "Cookie");
    for (const [name, { value, options }] of pending)
      response.cookies.set(name, value, {
        ...options,
        path: "/api/admin",
        httpOnly: true,
        sameSite: "strict",
        secure: config.secureCookies,
      });
    return response;
  };
  return { client, clear, respond };
}

/** Never authorize using cookie claims, getSession(), or client-provided email. */
export async function requireAdministrator(
  client: SupabaseClient,
  config: AdminConfig,
) {
  const { data, error } = await client.auth.getUser();
  if (error && (!error.status || error.status >= 500))
    throw new DomainError(
      503,
      "Administrator identity could not be verified right now. Please retry.",
    );
  if (error || !data.user)
    throw new DomainError(401, "Sign in as an approved administrator.");
  const user = data.user;
  if (
    !user.email_confirmed_at ||
    user.is_anonymous ||
    !user.email ||
    !config.emails.includes(user.email.toLowerCase())
  )
    throw new DomainError(
      403,
      "This account does not have administrator access.",
    );
  return { id: user.id, email: user.email };
}

type Context = ReturnType<typeof adminAuthContext>;
export async function adminEndpoint(
  request: NextRequest,
  work: (context: Context, config: AdminConfig) => Promise<unknown>,
  settings?: { config: AdminConfig; fetcher: typeof fetch },
) {
  let context: Context | undefined;
  try {
    const config = settings?.config ?? adminConfig();
    requireAdminOrigin(request, config);
    context = adminAuthContext(request, config, settings?.fetcher);
    return context.respond(await work(context, config));
  } catch (error) {
    const status = error instanceof DomainError ? error.status : 503;
    if (status === 401 || status === 403) context?.clear();
    const body = {
      error:
        error instanceof DomainError
          ? error.message
          : "Administrator service is temporarily unavailable. Please retry.",
    };
    return context
      ? context.respond(body, status)
      : NextResponse.json(body, {
          status,
          headers: { "Cache-Control": "private, no-store, max-age=0" },
        });
  }
}

export async function sendAdminCode(
  request: NextRequest,
  context: Context,
  config: AdminConfig,
) {
  const parsed = sendSchema.safeParse(await readOperation(request));
  if (!parsed.success)
    throw new DomainError(400, "Enter a valid email address.");
  const message =
    "If this is an approved, existing administrator account, a sign-in code will arrive by email.";
  if (!config.emails.includes(parsed.data.email)) return { message };
  const { error } = await context.client.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: false },
  });
  // Do not disclose allowlist membership/provider account existence to the caller.
  // Provider delivery and rate-limit configuration must be checked before launch.
  if (error) return { message };
  return { message };
}

export async function verifyAdminCode(
  request: NextRequest,
  context: Context,
  config: AdminConfig,
) {
  const parsed = verifySchema.safeParse(await readOperation(request));
  if (!parsed.success)
    throw new DomainError(400, "Enter your email and six-digit code.");
  if (!config.emails.includes(parsed.data.email))
    throw new DomainError(401, "The sign-in code is invalid or expired.");
  const { error } = await context.client.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.code,
    type: "email",
  });
  if (error)
    throw new DomainError(401, "The sign-in code is invalid or expired.");
  return { administrator: await requireAdministrator(context.client, config) };
}

export async function signOutAdministrator(context: Context) {
  let error;
  try {
    ({ error } = await context.client.auth.signOut({ scope: "local" }));
  } finally {
    context.clear();
  }
  if (error)
    throw new DomainError(
      503,
      "Local sign-in cleared, but server sign-out could not be confirmed. Close this window and contact the organizer.",
    );
  return { signedOut: true };
}
