import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  adminConfig,
  requireAdminOrigin,
  type AdminConfig,
} from "../../src/server/admin-config";
import {
  adminEndpoint,
  requireAdministrator,
  sendAdminCode,
  verifyAdminCode,
  signOutAdministrator,
} from "../../src/server/admin-auth";
import { postgresOptions } from "../../src/server/postgres";

const config: AdminConfig = {
  origin: "https://outreach.example.test",
  supabaseUrl: "https://synthetic.supabase.co",
  publishableKey: "sb_publishable_synthetic_test",
  emails: ["organizer@example.test"],
  secureCookies: true,
};
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: config.emails[0],
  email_confirmed_at: "2026-01-01T00:00:00Z",
  is_anonymous: false,
  created_at: "2026-01-01T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
  identities: [],
};
const jwt = () =>
  [
    { alg: "HS256", typ: "JWT" },
    { sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 },
  ]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
    .join(".") + ".test-signature";
const session = () => ({
  access_token: jwt(),
  refresh_token: "synthetic-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
});
const cookie = () =>
  `jco-admin-session=base64-${Buffer.from(JSON.stringify(session())).toString("base64url")}`;
const request = (
  body?: unknown,
  cookieHeader?: string,
  method = body ? "POST" : "GET",
) =>
  new NextRequest(`${config.origin}/api/admin/test`, {
    method,
    headers: {
      "X-JCO-Admin": "1",
      Origin: config.origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function provider(
  overrides: {
    confirmed?: boolean;
    email?: string;
    anonymous?: boolean;
    reject?: boolean;
  } = {},
) {
  const calls: { path: string; body: Record<string, unknown> | undefined }[] =
    [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    ).pathname;
    calls.push({
      path,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (overrides.reject)
      return json(
        {
          msg: "SYNTHETIC provider secret must not leak",
          code: "invalid_credentials",
        },
        401,
      );
    if (path.endsWith("/otp")) return json({});
    if (path.endsWith("/verify")) return json(session());
    if (path.endsWith("/token")) return json(session());
    if (path.endsWith("/user"))
      return json({
        ...user,
        email: overrides.email ?? user.email,
        is_anonymous: overrides.anonymous ?? false,
        email_confirmed_at:
          overrides.confirmed === false ? null : user.email_confirmed_at,
      });
    if (path.endsWith("/logout")) return new Response(null, { status: 204 });
    throw new Error(`Unexpected synthetic provider path: ${path}`);
  };
  return { fetcher, calls };
}

test("administrator configuration is explicit, hosted-synthetic only, and rejects insecure/privileged settings", () => {
  const env = {
    JCO_HOSTED_STAGE: "synthetic-preview",
    JCO_APP_ORIGIN: config.origin,
    JCO_SUPABASE_URL: config.supabaseUrl,
    JCO_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
    JCO_ADMIN_EMAILS: " Organizer@example.test ",
  };
  assert.deepEqual(adminConfig(env).emails, config.emails);
  for (const patch of [
    { JCO_HOSTED_STAGE: "production" },
    { JCO_SYNTHETIC_ONLY: "1" },
    { JCO_ADMIN_EMAILS: "" },
    { JCO_ADMIN_EMAILS: "*@example.test" },
    { JCO_SUPABASE_PUBLISHABLE_KEY: "sb_secret_do-not-use" },
    { JCO_APP_ORIGIN: "http://public.example.test" },
    { JCO_APP_ORIGIN: `${config.origin}/evil` },
    { JCO_SUPABASE_URL: "https://attacker.test" },
    { JCO_SUPABASE_URL: `${config.supabaseUrl}/other` },
  ]) {
    assert.throws(() => adminConfig({ ...env, ...patch }));
  }
});

test("administrator requests require the configured origin and custom header; demo and forwarded headers do not grant access", () => {
  requireAdminOrigin(request({}), config);
  const cases: Record<string, string>[] = [
    { Origin: "https://evil.test", "X-JCO-Admin": "1" },
    { "X-JCO-Admin": "1" },
    { Origin: config.origin, "X-JCO-Demo": "1" },
    {
      Origin: "https://evil.test",
      "X-JCO-Admin": "1",
      "X-Forwarded-Host": "outreach.example.test",
    },
  ];
  for (const headers of cases) {
    assert.throws(() =>
      requireAdminOrigin(
        new Request(`${config.origin}/api/admin/send-code`, {
          method: "POST",
          headers,
        }),
        config,
      ),
    );
  }
});

test("email code delivery disables signup and gives the same message to a non-allowlisted caller", async () => {
  const fake = provider();
  const send = (email: string) => {
    const req = request({ email });
    return adminEndpoint(req, (ctx, cfg) => sendAdminCode(req, ctx, cfg), {
      config,
      fetcher: fake.fetcher,
    });
  };
  const accepted = await send(config.emails[0]);
  const denied = await send("stranger@example.test");
  assert.deepEqual(await accepted.json(), await denied.json());
  assert.equal(fake.calls.filter((c) => c.path.endsWith("/otp")).length, 1);
  assert.equal(fake.calls[0].body?.create_user, false);
  assert.match(accepted.headers.get("cache-control")!, /no-store/);
});

test("verified provider identity gets HTTP-only scoped cookies and no tokens in JSON", async () => {
  const fake = provider(),
    req = request({ email: config.emails[0], code: "123456" });
  const response = await adminEndpoint(
    req,
    (ctx, cfg) => verifyAdminCode(req, ctx, cfg),
    { config, fetcher: fake.fetcher },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    administrator: { id: user.id, email: user.email },
  });
  const cookies = response.headers.getSetCookie().join(";");
  for (const pattern of [
    /HttpOnly/i,
    /Secure/i,
    /SameSite=strict/i,
    /Path=\/api\/admin/i,
  ])
    assert.match(cookies, pattern);
  assert.ok(
    fake.calls.some((c) => c.path.endsWith("/user")),
    "fresh provider verification is required after OTP",
  );
});

test("a cookie claiming an administrator cannot override provider denial, changed email, anonymous or unconfirmed identity", async () => {
  for (const override of [
    { reject: true },
    { email: "stranger@example.test" },
    { confirmed: false },
    { anonymous: true },
  ]) {
    const fake = provider(override);
    let accessed = false;
    const response = await adminEndpoint(
      request(undefined, cookie()),
      async (ctx, cfg) => {
        await requireAdministrator(ctx.client, cfg);
        accessed = true;
        return {};
      },
      { config, fetcher: fake.fetcher },
    );
    assert.ok([401, 403].includes(response.status));
    assert.equal(accessed, false);
    assert.ok(fake.calls.some((c) => c.path.endsWith("/user")));
    assert.match(response.headers.getSetCookie().join(";"), /Max-Age=0/i);
    assert.doesNotMatch(await response.text(), /SYNTHETIC provider secret/);
  }
});

test("missing session never reaches protected work; removing allowlist access takes effect on the next request", async () => {
  const fake = provider();
  let accessed = false;
  const work = async (
    ctx: Parameters<Parameters<typeof adminEndpoint>[1]>[0],
    cfg: AdminConfig,
  ) => {
    const identity = await requireAdministrator(ctx.client, cfg);
    accessed = true;
    return identity;
  };
  assert.equal(
    (await adminEndpoint(request(), work, { config, fetcher: fake.fetcher }))
      .status,
    401,
  );
  assert.equal(accessed, false);
  assert.equal(
    (
      await adminEndpoint(request(undefined, cookie()), work, {
        config,
        fetcher: fake.fetcher,
      })
    ).status,
    200,
  );
  accessed = false;
  assert.equal(
    (
      await adminEndpoint(request(undefined, cookie()), work, {
        config: { ...config, emails: [] },
        fetcher: fake.fetcher,
      })
    ).status,
    403,
  );
  assert.equal(accessed, false);
});

test("wrong codes and unexpected auth input reject without session cookies or provider error leakage", async () => {
  const fake = provider({ reject: true });
  for (const body of [
    { email: user.email, code: "123456" },
    { email: user.email, code: "123456", administrator: true },
  ]) {
    const req = request(body);
    const response = await adminEndpoint(
      req,
      (ctx, cfg) => verifyAdminCode(req, ctx, cfg),
      { config, fetcher: fake.fetcher },
    );
    assert.ok([400, 401].includes(response.status));
    assert.doesNotMatch(await response.text(), /provider secret/);
  }
});

test("sign-out revokes this provider session and expires local administrator cookies", async () => {
  const fake = provider();
  const response = await adminEndpoint(
    request(undefined, cookie(), "DELETE"),
    (ctx) => signOutAdministrator(ctx),
    { config, fetcher: fake.fetcher },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.getSetCookie().join(";"), /Max-Age=0/i);
  assert.ok(fake.calls.some((c) => c.path.endsWith("/logout")));
});

test("PostgreSQL runtime TLS cannot be downgraded with connection-string parameters", () => {
  const url =
    "postgresql://jco_admin_reader:synthetic@db.example.test:5432/postgres";
  assert.deepEqual(postgresOptions(url).ssl, { rejectUnauthorized: true });
  for (const suffix of [
    "?sslmode=disable",
    "?sslmode=no-verify",
    "?sslcert=other",
    "#ignored",
  ])
    assert.throws(() => postgresOptions(url + suffix));
  assert.throws(() => postgresOptions("https://example.test"));
});

test("expired session refresh uses the provider and forwards renewed cookies with no-store headers", async () => {
  const fake = provider();
  const expired = {
    ...session(),
    expires_at: Math.floor(Date.now() / 1000) - 100,
  };
  const cookieHeader = `jco-admin-session=base64-${Buffer.from(JSON.stringify(expired)).toString("base64url")}`;
  const response = await adminEndpoint(
    request(undefined, cookieHeader),
    async (ctx, cfg) => ({
      administrator: await requireAdministrator(ctx.client, cfg),
    }),
    { config, fetcher: fake.fetcher },
  );
  assert.equal(response.status, 200);
  assert.ok(fake.calls.some((c) => c.path.endsWith("/token")));
  assert.ok(fake.calls.some((c) => c.path.endsWith("/user")));
  assert.match(response.headers.getSetCookie().join(";"), /HttpOnly/i);
  assert.match(response.headers.get("cache-control")!, /no-store/);
});

test("provider outages do not leak provider errors or silently allow access", async () => {
  const req = request(undefined, cookie());
  const unavailable: typeof fetch = async () =>
    json({ message: "SYNTHETIC private provider failure" }, 502);
  const response = await adminEndpoint(
    req,
    async (ctx, cfg) => requireAdministrator(ctx.client, cfg),
    { config, fetcher: unavailable },
  );
  assert.equal(response.status, 503);
  assert.equal(
    response.headers.getSetCookie().length,
    0,
    "temporary provider failure must not discard a valid local session",
  );
  assert.doesNotMatch(await response.text(), /private provider failure/);
});
