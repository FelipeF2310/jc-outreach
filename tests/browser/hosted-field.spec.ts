import { test, expect } from "@playwright/test";
import { createServer, request as proxyRequest } from "node:http";
import type { AddressInfo } from "node:net";
import type { Assignment, Operation } from "../../src/lib/contracts";
import type { FieldSnapshot } from "../../src/lib/field-admin-contracts";

test("hosted link UI handles lost issuance, local visits, sync retries, results and explicit revocation (mock transport)", async ({
  page,
  context,
}) => {
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const token = "s".repeat(43);
  const assignment: Assignment = {
    id: id(1),
    campaignId: id(2),
    name: "Practice Volunteer A",
    eventName: "Practice Event",
    eventEndsAt: "2030-10-01T21:00:00Z",
    deletionAt: "2030-11-11T04:59:59Z",
    synthetic: true,
    programs: [],
    households: [
      {
        id: id(3),
        buildingId: id(4),
        address: "100 FIXTURE WALK",
        unit: "2A",
        suppressed: false,
        people: [
          { id: id(5), firstName: "Resident A", lastName: "Fixture" },
          { id: id(6), firstName: "Resident B", lastName: "Fixture" },
        ],
      },
      {
        id: id(7),
        buildingId: id(4),
        address: "100 FIXTURE WALK",
        unit: "10B",
        suppressed: false,
        people: [{ id: id(8), firstName: "Resident C", lastName: "Fixture" }],
      },
    ],
  };
  const state: FieldSnapshot = {
    labelsReady: true,
    assignmentId: assignment.id,
    eventEndsAt: assignment.eventEndsAt,
    uploadEndsAt: "2030-10-04T21:00:00Z",
    deletionAt: assignment.deletionAt,
    credentials: [],
    visits: [],
    counts: { attempts: 0, repeats: 0, conversations: 0 },
    buildingFailures: 0,
    helpRequests: 0,
    latestReceivedAt: null,
  };
  let lostIssue = true,
    lostReceipt = true,
    activeCredential = "";
  const received = new Map<string, string>();
  // Native HTTP mock transport: WebKit does not support intercepting all
  // service-worker-controlled requests through Playwright context.route.
  type MockRoute = {
    request(): {
      url(): string;
      postDataJSON(): ReturnType<
        import("@playwright/test").Request["postDataJSON"]
      >;
    };
    fulfill(value: { json: unknown; status?: number }): Promise<void>;
    abort(reason: string): Promise<void>;
  };
  const handlers = new Map<string, (route: MockRoute) => Promise<void>>();
  const stub = (path: string, handler: (route: MockRoute) => Promise<void>) =>
    handlers.set(path, handler);
  stub("admin", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/retention"))
      return route.fulfill({ json: { retention: { ready: false } } });
    if (path.endsWith("/session"))
      return route.fulfill({
        json: { administrator: { id: id(9), email: "organizer@example.test" } },
      });
    if (path.endsWith("/campaigns"))
      return route.fulfill({
        json: {
          campaigns: [
            {
              id: assignment.campaignId,
              name: "Synthetic: Field loop",
              endAt: "2030-10-12T03:59:59Z",
              deletionAt: assignment.deletionAt,
              importReady: true,
              assignmentsReady: true,
              fieldReady: true,
              importReceipt: {
                campaignId: assignment.campaignId,
                importId: id(10),
                counts: { people: 3, households: 2, buildings: 1 },
                finalizedAt: "2026-09-15T00:00:00Z",
              },
            },
          ],
        },
      });
    if (path.endsWith("/assignments"))
      return route.fulfill({
        json: {
          workspace: {
            campaignId: assignment.campaignId,
            endAt: assignment.eventEndsAt,
            deletionAt: assignment.deletionAt,
            households: assignment.households.map((h) => ({
              id: h.id,
              buildingId: h.buildingId,
              address: h.address,
              unit: h.unit,
              ward: "A",
              peopleCount: h.people.length,
              suppressed: false,
            })),
            events: [
              {
                id: id(11),
                name: assignment.eventName,
                endsAt: assignment.eventEndsAt,
              },
            ],
            assignments: [
              {
                id: assignment.id,
                eventId: id(11),
                name: assignment.name,
                kind: "building",
                householdIds: assignment.households.map((h) => h.id),
              },
            ],
          },
        },
      });
    if (path.endsWith("/help"))
      return route.fulfill({
        json: {
          queue: {
            campaignId: assignment.campaignId,
            ready: false,
            requests: [],
          },
        },
      });
    if (path.endsWith("/corrections"))
      return route.fulfill({
        json: {
          queue: {
            campaignId: route.request().postDataJSON().campaignId,
            ready: false,
            reports: [],
          },
        },
      });
    expect(path).toBe("/api/admin/field");
    const input = route.request().postDataJSON();
    if (input.action === "issue") {
      const existing = state.credentials.some((c) => c.id === input.id);
      if (!existing)
        state.credentials.push({
          id: input.id,
          label: input.label,
          issuedAt: new Date().toISOString(),
          revoked: false,
          revokedAt: null,
        });
      if (lostIssue) {
        lostIssue = false;
        // Failure after the mock commit, without Chromium's automatic TCP retry.
        return route.fulfill({
          status: 503,
          json: {
            error:
              "Issuance committed but acknowledgment unavailable. Retry the pending action.",
          },
        });
      }
      if (!existing) activeCredential = input.id;
      return route.fulfill({
        json: {
          snapshot: state,
          credentialId: input.id,
          token: existing ? null : token,
        },
      });
    }
    if (input.action === "revoke") {
      expect(input.confirmed).toBe(true);
      const c = state.credentials.find((c) => c.id === input.id)!;
      c.revoked = true;
      c.revokedAt = new Date().toISOString();
    }
    return route.fulfill({ json: { snapshot: state } });
  });
  stub("/api/assignment", (route) => route.fulfill({ json: assignment }));
  stub("/api/operations", async (route) => {
    if (state.credentials.find((c) => c.id === activeCredential)?.revoked)
      return route.fulfill({
        status: 403,
        json: {
          error:
            "This assignment link was revoked. Pending work remains on this device.",
        },
      });
    const op: Operation = route.request().postDataJSON();
    if (!received.has(op.id)) {
      received.set(op.id, new Date().toISOString());
      if (op.kind === "visit") {
        const h = assignment.households.find((h) => h.id === op.householdId)!;
        state.visits.push({
          id: op.visitId,
          address: h.address,
          unit: h.unit,
          result: op.result,
          receivedAt: received.get(op.id)!,
        });
        state.counts = { attempts: 1, repeats: 0, conversations: 1 };
        state.helpRequests = op.help ? 1 : 0;
        state.latestReceivedAt = received.get(op.id)!;
      }
    }
    if (lostReceipt) {
      lostReceipt = false;
      return route.fulfill({
        status: 503,
        json: { error: "Submission committed but acknowledgment unavailable." },
      });
    }
    return route.fulfill({
      json: { operationId: op.id, receivedAt: received.get(op.id) },
    });
  });
  const proxy = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://127.0.0.1").pathname;
    const handler = handlers.get(
      path.startsWith("/api/admin/") ? "admin" : path,
    );
    if (handler) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      try {
        await handler({
          request: () => ({
            url: () => `http://127.0.0.1${req.url}`,
            postDataJSON: () =>
              JSON.parse(Buffer.concat(chunks).toString("utf8")),
          }),
          fulfill: async ({ json, status = 200 }) => {
            res.writeHead(status, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            });
            res.end(JSON.stringify(json));
          },
          abort: async () => {
            req.socket.destroy();
          },
        });
      } catch {
        res.writeHead(500);
        res.end();
      }
      return;
    }
    const upstream = proxyRequest(
      {
        hostname: "127.0.0.1",
        port: 3100,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  try {
    await page.goto(`${origin}/admin`);
    const controls = page.getByRole("region", {
      name: "Volunteer links for Practice Volunteer A",
    });
    await controls
      .getByRole("button", { name: "Volunteer links", exact: true })
      .click();
    await controls.getByLabel("Volunteer / link name").fill("   ");
    await expect(
      controls.getByRole("button", { name: "Generate private link" }),
    ).toBeDisabled();
    await controls
      .getByLabel("Volunteer / link name")
      .fill("Practice Alex — Saturday");
    await controls
      .getByRole("button", { name: "Generate private link" })
      .click();
    await expect(
      controls.getByRole("button", { name: "Retry pending link action" }),
    ).toBeEnabled();
    await page.reload();
    await expect(
      controls.getByLabel("Volunteer / link name"),
    ).not.toBeVisible();
    await controls
      .getByRole("button", { name: "Retry pending link action" })
      .click();
    await expect(
      controls.getByText(/This link was already created/),
    ).toBeVisible();
    expect(state.credentials).toHaveLength(1);
    await expect(controls.getByLabel("Volunteer / link name")).toHaveValue(
      "Practice Alex — Saturday",
    );
    await expect(
      controls.getByText("Practice Alex — Saturday", { exact: true }),
    ).toBeVisible();
    await controls
      .getByLabel("Volunteer / link name")
      .fill("Practice Blake — Sunday");
    await controls
      .getByRole("button", { name: "Generate private link" })
      .click();
    await expect(
      controls.getByRole("link", { name: "Open volunteer assignment" }),
    ).toBeVisible();
    expect(state.credentials).toHaveLength(2);
    expect(state.credentials.map((c) => c.label)).toEqual([
      "Practice Alex — Saturday",
      "Practice Blake — Sunday",
    ]);
    expect(
      await page.evaluate(
        (t) =>
          JSON.stringify({ ...localStorage, ...sessionStorage }).includes(t),
        token,
      ),
    ).toBe(false);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
    }
    // Mask the private-link surface even though this credential is only a test fixture.
    await controls.screenshot({
      path: `test-results/hosted-links-${test.info().project.name}.png`,
      mask: [controls.locator(".private-link-box")],
    });
    const popup = context.waitForEvent("page");
    await controls
      .getByRole("link", { name: "Open volunteer assignment" })
      .click();
    const volunteer = await popup;
    await volunteer
      .getByRole("button", { name: "Download assignment", exact: true })
      .click();
    await expect(
      volunteer.getByText("Ready offline", { exact: true }),
    ).toBeVisible();
    await expect(volunteer).toHaveURL(/\/field$/);
    await volunteer.getByRole("button", { name: /Unit 2A/ }).click();
    await volunteer.getByLabel("Spoke with resident", { exact: true }).check();
    await volunteer.getByLabel("Wants application help").check();
    await volunteer.getByRole("button", { name: "Save & next" }).click();
    await expect(
      volunteer.getByText("1 waiting to sync", { exact: true }),
    ).toBeVisible();
    await volunteer.close();
    const reopened = await context.newPage();
    await reopened.goto(`${origin}/field`);
    await expect(
      reopened.getByText("1 waiting to sync", { exact: true }),
    ).toBeVisible();
    await reopened.getByRole("button", { name: "Sync now" }).click();
    await expect(
      reopened.getByRole("alert").filter({ hasText: /Upload interrupted/ }),
    ).toBeVisible();
    await reopened.getByRole("button", { name: "Sync now" }).click();
    await expect(
      reopened.getByText("All records received", { exact: true }),
    ).toBeVisible();
    expect(received.size).toBe(1);
    await page.reload();
    await controls
      .getByRole("button", { name: "Volunteer links", exact: true })
      .click();
    await expect(
      controls.getByLabel("Private volunteer link"),
    ).not.toBeVisible();
    await expect(
      controls.getByText("Practice Blake — Sunday", { exact: true }),
    ).toBeVisible();
    const results = page.getByRole("region", {
      name: "Results and follow-up",
      exact: true,
    });
    await expect(
      results
        .locator(".stat")
        .filter({ hasText: "Households attempted" })
        .locator("strong"),
    ).toHaveText("1");
    await expect(
      results
        .locator(".stat")
        .filter({ hasText: "Conversations" })
        .locator("strong"),
    ).toHaveText("1");
    await expect(
      results
        .locator(".stat")
        .filter({ hasText: "Application-help requests" })
        .locator("strong"),
    ).toHaveText("1");
    await expect(
      results.getByText("0 repeat visits · 0 building-access failures"),
    ).toBeVisible();
    await reopened.getByRole("button", { name: /Unit 10B/ }).click();
    await reopened.getByLabel("No answer", { exact: true }).check();
    await reopened.getByRole("button", { name: "Save & next" }).click();
    await controls
      .getByRole("button", {
        name: "Revoke link 2 — Practice Blake — Sunday",
        exact: true,
      })
      .click();
    expect(state.credentials[1].revoked).toBe(false);
    await controls
      .getByRole("button", {
        name: "Confirm revoke link 2 — Practice Blake — Sunday",
        exact: true,
      })
      .click();
    const activeLinks = controls.getByRole("region", {
      name: "Active links",
      exact: true,
    });
    const revokedLinks = controls
      .locator("details")
      .filter({ hasText: "Revoked links" });
    await expect(
      activeLinks.getByText("Practice Blake — Sunday", { exact: true }),
    ).toHaveCount(0);
    await expect(
      activeLinks.getByText("Practice Alex — Saturday", { exact: true }),
    ).toBeVisible();
    await expect(revokedLinks.locator("summary")).toHaveText(
      "Revoked links (1)",
    );
    await expect(
      controls.getByText("Link 2 · Revoked", { exact: false }),
    ).not.toBeVisible();
    await revokedLinks.locator("summary").click();
    await expect(
      revokedLinks.getByText("Practice Blake — Sunday", { exact: true }),
    ).toBeVisible();
    await expect(
      revokedLinks.getByText("Link 2 · Revoked", { exact: false }),
    ).toBeVisible();
    await expect(revokedLinks.getByText(/Revoked: /)).toBeVisible();
    await expect(revokedLinks.getByRole("button")).toHaveCount(0);
    await expect(revokedLinks.getByRole("link")).toHaveCount(0);
    await page.reload();
    await controls
      .getByRole("button", { name: "Volunteer links", exact: true })
      .click();
    await expect(revokedLinks.locator("summary")).toHaveText(
      "Revoked links (1)",
    );
    await expect(
      controls.getByText("Link 2 · Revoked", { exact: false }),
    ).not.toBeVisible();
    await expect(activeLinks.locator(".credential-row")).toHaveCount(1);
    await reopened.getByRole("button", { name: "Sync now" }).click();
    await expect(
      reopened.getByRole("alert").filter({ hasText: /revoked/ }),
    ).toBeVisible();
    await reopened.reload();
    await expect(
      reopened.getByText("1 waiting to sync", { exact: true }),
    ).toBeVisible();
    // An existing unnamed link retains its original number after grouping.
    state.credentials[0].label = null;
    state.eventEndsAt = "2020-01-01T00:00:00Z";
    await controls.getByRole("button", { name: "Refresh links" }).click();
    await expect(
      activeLinks.getByText("Link 1 · Upload only", { exact: false }),
    ).toBeVisible();
    state.uploadEndsAt = "2020-01-04T00:00:00Z";
    await controls.getByRole("button", { name: "Refresh links" }).click();
    await expect(
      activeLinks.getByText("No active links.", { exact: true }),
    ).toBeVisible();
    const expiredLinks = controls
      .locator("details")
      .filter({ hasText: "Expired links" });
    await expect(expiredLinks.locator("summary")).toHaveText(
      "Expired links (1)",
    );
    await expiredLinks.locator("summary").click();
    await expect(
      expiredLinks.getByText("Link 1 · Expired", { exact: false }),
    ).toBeVisible();
    await expect(expiredLinks.getByRole("button")).toHaveCount(0);
    await expect(revokedLinks.locator("summary")).toHaveText(
      "Revoked links (1)",
    );

    // Simulate another administrator revoking a link still displayed in this tab.
    state.eventEndsAt = assignment.eventEndsAt;
    state.uploadEndsAt = "2030-10-04T21:00:00Z";
    await controls.getByRole("button", { name: "Refresh links" }).click();
    await expect(activeLinks.locator(".credential-row")).toHaveCount(1);
    await controls.getByLabel("Volunteer / link name").fill("Practice Casey");
    await controls
      .getByRole("button", { name: "Generate private link" })
      .click();
    await expect(controls.getByLabel("Private volunteer link")).toBeVisible();
    for (const credential of state.credentials) {
      credential.revoked = true;
      credential.revokedAt ??= new Date().toISOString();
    }
    await controls.getByRole("button", { name: "Refresh links" }).click();
    await expect(
      activeLinks.getByText("No active links.", { exact: true }),
    ).toBeVisible();
    await expect(
      controls.getByLabel("Private volunteer link"),
    ).not.toBeVisible();
    await expect(
      controls.getByRole("link", { name: "Open volunteer assignment" }),
    ).toHaveCount(0);
    await expect(
      controls.getByRole("button", { name: "Copy private link" }),
    ).toHaveCount(0);
    await expect(revokedLinks.locator("summary")).toHaveText(
      "Revoked links (3)",
    );
    expect(state.visits).toHaveLength(1);
    await revokedLinks.locator("summary").click();
    await expect(
      revokedLinks.getByText("Link 1 · Revoked", { exact: false }),
    ).toBeVisible();
    await controls.screenshot({
      path: `test-results/revoked-links-${test.info().project.name}.png`,
    });
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});
