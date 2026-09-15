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
  signInAdministrator,
  signOutAdministrator,
} from "../../src/server/admin-auth";
import { hostedDatabase, postgresOptions } from "../../src/server/postgres";
import { createAdministratorCampaign } from "../../src/server/admin-campaigns";
import { importAdministratorExample } from "../../src/server/admin-imports";
import { prepareAdministratorAssignment } from "../../src/server/admin-assignments";
import { manageAdministratorField } from "../../src/server/admin-field";
import { manageAdministratorHelp } from "../../src/server/admin-help";
import { manageAdministratorCorrection } from "../../src/server/admin-corrections";
import type { Database } from "../../src/server/db-contract";

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

test("campaign POST authenticates before database access and takes its actor only from verified identity", async () => {
  let opened = 0;
  let parameters: unknown[] | undefined;
  const db: Database = {
    async query<T>(_sql: string, params?: unknown[]) {
      if (!params)
        return {
          rows: [
            { stage: "synthetic-preview", role: "jco_admin_reader" },
          ] as T[],
        };
      parameters = params;
      return { rows: [] };
    },
    async exec() {},
    async transaction(work) {
      return work(db);
    },
  };
  const database = () => {
    opened++;
    return db;
  };
  const input = { id: user.id, name: "Practice", endDate: "2030-03-01" };
  for (const [req, fake, expected] of [
    [request(input), provider(), 401],
    [
      request(input, cookie()),
      provider({ email: "unapproved@example.test" }),
      403,
    ],
    [
      new NextRequest(`${config.origin}/api/admin/campaigns`, {
        method: "POST",
        headers: {
          Origin: "https://untrusted.example.test",
          "X-JCO-Admin": "1",
        },
      }),
      provider(),
      403,
    ],
  ] as const) {
    const response = await adminEndpoint(
      req,
      (ctx, cfg) => createAdministratorCampaign(req, ctx, cfg, database),
      { config, fetcher: fake.fetcher },
    );
    assert.equal(response.status, expected);
    assert.match(response.headers.get("cache-control")!, /no-store/);
  }
  assert.equal(opened, 0);
  const req = request(input, cookie());
  await adminEndpoint(
    req,
    (ctx, cfg) => createAdministratorCampaign(req, ctx, cfg, database),
    { config, fetcher: provider().fetcher },
  );
  assert.deepEqual(parameters, [input.id, input.name, input.endDate, user.id]);
  parameters = undefined;
  const forged = request({ ...input, createdBy: "client-supplied" }, cookie());
  const rejected = await adminEndpoint(
    forged,
    (ctx, cfg) => createAdministratorCampaign(forged, ctx, cfg, database),
    { config, fetcher: provider().fetcher },
  );
  assert.equal(rejected.status, 400);
  assert.equal(parameters, undefined);
});

test("synthetic import endpoints authorize before reading input or opening a database", async () => {
  let opened = 0;
  const database = (): Database => {
    opened++;
    throw new Error("Must not open database");
  };
  for (const action of ["preview", "finalize"]) {
    const input = {
      action,
      campaignId: user.id,
      caseId: "valid-couple-and-buildings",
      digest: "0".repeat(64),
      confirmed: true,
    };
    for (const [req, fake, status] of [
      [request(input), provider(), 401],
      [
        request(input, cookie()),
        provider({ email: "unapproved@example.test" }),
        403,
      ],
      [
        new NextRequest(`${config.origin}/api/admin/import`, {
          method: "POST",
          headers: {
            Origin: "https://untrusted.example.test",
            "X-JCO-Admin": "1",
            Cookie: cookie(),
          },
        }),
        provider(),
        403,
      ],
      [
        new NextRequest(`${config.origin}/api/admin/import`, {
          method: "POST",
          headers: {
            Origin: config.origin,
            "X-JCO-Admin": "1",
            Cookie: cookie(),
            "Content-Type": "text/csv",
          },
          body: "not an accepted upload",
        }),
        provider(),
        415,
      ],
    ] as const) {
      const response = await adminEndpoint(
        req,
        (ctx, cfg) => importAdministratorExample(req, ctx, cfg, database),
        { config, fetcher: fake.fetcher },
      );
      assert.equal(response.status, status);
      assert.match(response.headers.get("cache-control")!, /no-store/);
    }
  }
  assert.equal(opened, 0);
});

test("assignment preparation authenticates before opening a database", async () => {
  let opened = 0;
  const database = (): Database => {
    opened++;
    throw new Error("Must not open database");
  };
  for (const [req, fake, status] of [
    [request({ action: "workspace", campaignId: user.id }), provider(), 401],
    [
      request({ action: "workspace", campaignId: user.id }, cookie()),
      provider({ email: "unapproved@example.test" }),
      403,
    ],
    [
      new NextRequest(`${config.origin}/api/admin/assignments`, {
        method: "POST",
        headers: {
          Origin: "https://untrusted.example.test",
          "X-JCO-Admin": "1",
          Cookie: cookie(),
        },
      }),
      provider(),
      403,
    ],
  ] as const) {
    const response = await adminEndpoint(
      req,
      (ctx, cfg) => prepareAdministratorAssignment(req, ctx, cfg, database),
      { config, fetcher: fake.fetcher },
    );
    assert.equal(response.status, status);
    assert.match(response.headers.get("cache-control")!, /no-store/);
  }
  assert.equal(opened, 0);
});

test("reassignment uses verified administrator identity, never a client actor", async () => {
  const input = {
    action: "reassign",
    id: user.id,
    campaignId: user.id,
    sourceId: "10000000-0000-4000-8000-000000000001",
    name: "New practice volunteer",
    householdIds: [user.id],
    confirmed: true,
  };
  let parameters: unknown[] | undefined;
  const db: Database = {
    async query<T>(sql: string, params?: unknown[]) {
      if (!params)
        return {
          rows: [
            { stage: "synthetic-preview", role: "jco_admin_reader" },
          ] as T[],
        };
      if (sql.includes("reassign_households")) {
        parameters = params;
        return { rows: [{ id: input.id }] as T[] };
      }
      return {
        rows: [
          {
            workspace: {
              campaignId: input.campaignId,
              households: [],
              events: [],
              assignments: [],
            },
          },
        ] as T[],
      };
    },
    async exec() {},
    async transaction(work) {
      return work(db);
    },
  };
  for (const [body, expected] of [
    [input, 200],
    [{ ...input, actor: input.sourceId }, 400],
  ] as const) {
    parameters = undefined;
    const req = request(body, cookie());
    const response = await adminEndpoint(
      req,
      (ctx, cfg) => prepareAdministratorAssignment(req, ctx, cfg, () => db),
      { config, fetcher: provider().fetcher },
    );
    assert.equal(response.status, expected);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.deepEqual(
      parameters,
      expected === 200
        ? [
            input.id,
            input.campaignId,
            input.sourceId,
            input.name,
            input.householdIds,
            user.id,
          ]
        : undefined,
    );
  }
});

test("private link management requires verified administrator access before database or body access", async () => {
  let opened = 0;
  const database = (): Database => {
    opened++;
    throw Error("Must not open database");
  };
  for (const action of ["status", "issue", "revoke"]) {
    const input = {
      action,
      assignmentId: user.id,
      id: user.id,
      confirmed: true,
    };
    for (const [req, fake, status] of [
      [request(input), provider(), 401],
      [
        request(input, cookie()),
        provider({ email: "unapproved@example.test" }),
        403,
      ],
      [
        new NextRequest(`${config.origin}/api/admin/field`, {
          method: "POST",
          headers: {
            Origin: "https://untrusted.example.test",
            "X-JCO-Admin": "1",
            Cookie: cookie(),
          },
        }),
        provider(),
        403,
      ],
    ] as const) {
      const response = await adminEndpoint(
        req,
        (ctx, cfg) => manageAdministratorField(req, ctx, cfg, database),
        { config, fetcher: fake.fetcher },
      );
      assert.equal(response.status, status);
      assert.match(response.headers.get("cache-control")!, /no-store/);
    }
  }
  assert.equal(opened, 0);
});

test("missing database configuration explains setup only after authorization and preserves the session", async (t) => {
  const overrides = {
    JCO_HOSTED_STAGE: "synthetic-preview",
    JCO_SYNTHETIC_ONLY: "",
    DATABASE_URL: "",
  };
  const prior = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, overrides);
  const fake = provider();
  const work: Parameters<typeof adminEndpoint>[1] = async (ctx, cfg) => {
    await requireAdministrator(ctx.client, cfg);
    hostedDatabase();
    return {};
  };
  const denied = await adminEndpoint(request(), work, {
    config,
    fetcher: fake.fetcher,
  });
  assert.equal(denied.status, 401);
  assert.doesNotMatch(await denied.text(), /Database setup/);
  const response = await adminEndpoint(request(undefined, cookie()), work, {
    config,
    fetcher: fake.fetcher,
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Database setup is incomplete/);
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.match(response.headers.get("cache-control")!, /no-store/);
});
test("correction queue requires administrator verification and takes status actor only from the provider", async () => {
  let opened = 0;
  let updateParameters: unknown[] | undefined;
  const db: Database = {
    async query<T>(sql: string, params?: unknown[]) {
      if (sql.includes("update_correction_status($1")) {
        updateParameters = params;
        return { rows: [] };
      }
      return {
        rows: [
          { stage: "synthetic-preview", role: "jco_admin_reader", ready: true },
        ] as T[],
      };
    },
    async exec() {},
    async transaction(work) {
      return work(db);
    },
  };
  const database = () => {
    opened++;
    return db;
  };
  const input = {
    action: "update",
    id: user.id,
    campaignId: user.id,
    reportId: user.id,
    expectedVersion: 0,
    status: "Reviewed",
  };
  for (const [req, fake, status] of [
    [request(input), provider(), 401],
    [
      request(input, cookie()),
      provider({ email: "unapproved@example.test" }),
      403,
    ],
    [
      new NextRequest(`${config.origin}/api/admin/corrections`, {
        method: "POST",
        headers: {
          Origin: "https://untrusted.example.test",
          "X-JCO-Admin": "1",
          Cookie: cookie(),
        },
      }),
      provider(),
      403,
    ],
  ] as const) {
    const response = await adminEndpoint(
      req,
      (ctx, cfg) => manageAdministratorCorrection(req, ctx, cfg, database),
      { config, fetcher: fake.fetcher },
    );
    assert.equal(response.status, status);
    assert.match(response.headers.get("cache-control")!, /no-store/);
  }
  assert.equal(opened, 0);
  const req = request(input, cookie());
  await adminEndpoint(
    req,
    (ctx, cfg) => manageAdministratorCorrection(req, ctx, cfg, database),
    { config, fetcher: provider().fetcher },
  );
  assert.deepEqual(updateParameters, [
    input.id,
    input.campaignId,
    input.reportId,
    0,
    "Reviewed",
    user.id,
  ]);
});

test("help queue requires administrator verification and takes status actor only from the provider", async () => {
  let opened = 0;
  let updateParameters: unknown[] | undefined;
  const db: Database = {
    async query<T>(sql: string, params?: unknown[]) {
      if (sql.includes("update_help_status($1")) {
        updateParameters = params;
        return { rows: [] };
      }
      return {
        rows: [
          { stage: "synthetic-preview", role: "jco_admin_reader", ready: true },
        ] as T[],
      };
    },
    async exec() {},
    async transaction(work) {
      return work(db);
    },
  };
  const database = () => {
    opened++;
    return db;
  };
  const input = {
    action: "update",
    id: user.id,
    campaignId: user.id,
    requestId: user.id,
    expectedVersion: 0,
    status: "In progress",
  };
  for (const [req, fake, status] of [
    [request(input), provider(), 401],
    [
      request(input, cookie()),
      provider({ email: "unapproved@example.test" }),
      403,
    ],
    [
      new NextRequest(`${config.origin}/api/admin/help`, {
        method: "POST",
        headers: {
          Origin: "https://untrusted.example.test",
          "X-JCO-Admin": "1",
          Cookie: cookie(),
        },
      }),
      provider(),
      403,
    ],
  ] as const) {
    const response = await adminEndpoint(
      req,
      (ctx, cfg) => manageAdministratorHelp(req, ctx, cfg, database),
      { config, fetcher: fake.fetcher },
    );
    assert.equal(response.status, status);
    assert.match(response.headers.get("cache-control")!, /no-store/);
  }
  assert.equal(opened, 0);
  const req = request(input, cookie());
  await adminEndpoint(
    req,
    (ctx, cfg) => manageAdministratorHelp(req, ctx, cfg, database),
    { config, fetcher: provider().fetcher },
  );
  assert.deepEqual(updateParameters, [
    input.id,
    input.campaignId,
    input.requestId,
    0,
    "In progress",
    user.id,
  ]);
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
        new Request(`${config.origin}/api/admin/sign-in`, {
          method: "POST",
          headers,
        }),
        config,
      ),
    );
  }
});

test("unapproved emails and wrong passwords receive the same denial without signup or email delivery", async () => {
  const fake = provider({ reject: true });
  const send = (email: string) => {
    const req = request({ email, password: "synthetic-wrong-password" });
    return adminEndpoint(
      req,
      (ctx, cfg) => signInAdministrator(req, ctx, cfg),
      {
        config,
        fetcher: fake.fetcher,
      },
    );
  };
  const accepted = await send(config.emails[0]);
  const denied = await send("stranger@example.test");
  assert.equal(accepted.status, 401);
  assert.equal(denied.status, 401);
  assert.deepEqual(await accepted.json(), await denied.json());
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].path, "/auth/v1/token");
  assert.match(accepted.headers.get("cache-control")!, /no-store/);
});

test("verified provider identity gets HTTP-only scoped cookies and no tokens in JSON", async () => {
  const fake = provider(),
    req = request({
      email: " Organizer@example.test ",
      password: " synthetic-password ",
    });
  const response = await adminEndpoint(
    req,
    (ctx, cfg) => signInAdministrator(req, ctx, cfg),
    { config, fetcher: fake.fetcher },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    administrator: { id: user.id, email: user.email },
  });
  const cookies = response.headers.getSetCookie().join(";");
  assert.doesNotMatch(cookies, /synthetic-password/);
  assert.equal(fake.calls[0].body?.password, " synthetic-password ");
  assert.equal(fake.calls[0].body?.email, user.email);
  assert.ok(fake.calls.every((c) => !/\/(otp|verify|signup)$/.test(c.path)));
  for (const pattern of [
    /HttpOnly/i,
    /Secure/i,
    /SameSite=strict/i,
    /Path=\/api\/admin/i,
  ])
    assert.match(cookies, pattern);
  assert.ok(
    fake.calls.some((c) => c.path.endsWith("/user")),
    "fresh provider verification is required after password sign-in",
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

test("wrong passwords and invalid auth input reject without session cookies or provider error leakage", async () => {
  const fake = provider({ reject: true });
  for (const body of [
    { email: user.email, password: "synthetic-password" },
    { email: user.email, password: "synthetic-password", administrator: true },
    { email: user.email },
    { email: user.email, password: "" },
    { email: user.email, password: "x".repeat(1025) },
    { email: user.email, password: 123456 },
  ]) {
    const req = request(body);
    const response = await adminEndpoint(
      req,
      (ctx, cfg) => signInAdministrator(req, ctx, cfg),
      { config, fetcher: fake.fetcher },
    );
    assert.ok([400, 401].includes(response.status));
    assert.equal(response.headers.getSetCookie().length, 0);
    assert.doesNotMatch(await response.text(), /provider secret/);
  }
  assert.equal(
    fake.calls.length,
    1,
    "invalid input must not reach the provider",
  );
});

test("password sign-in rejects unconfirmed or unauthorized provider identity and clears issued cookies", async () => {
  for (const override of [
    { confirmed: false },
    { anonymous: true },
    { email: "other@example.test" },
  ]) {
    const fake = provider(override);
    const req = request({ email: user.email, password: "synthetic-password" });
    const response = await adminEndpoint(
      req,
      (ctx, cfg) => signInAdministrator(req, ctx, cfg),
      { config, fetcher: fake.fetcher },
    );
    assert.equal(response.status, 403);
    assert.ok(response.headers.getSetCookie().length > 0);
    assert.ok(
      response.headers
        .getSetCookie()
        .every((value) => /Max-Age=0/i.test(value)),
    );
  }
});

test("password sign-in safely reports rate limiting and provider outages", async () => {
  for (const [providerStatus, expected] of [
    [429, 429],
    [502, 503],
  ]) {
    const req = request({ email: user.email, password: "synthetic-password" });
    const response = await adminEndpoint(
      req,
      (ctx, cfg) => signInAdministrator(req, ctx, cfg),
      {
        config,
        fetcher: async () =>
          json(
            { message: "SYNTHETIC provider secret", code: "test_error" },
            providerStatus,
          ),
      },
    );
    assert.equal(response.status, expected);
    assert.doesNotMatch(
      await response.text(),
      /provider secret|synthetic-password/,
    );
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
