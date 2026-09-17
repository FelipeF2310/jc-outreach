import { test, expect } from "@playwright/test";
import { createServer, request as proxyRequest } from "node:http";
import type { AddressInfo } from "node:net";
import type { Assignment, Operation } from "../../src/lib/contracts";
import type { AssignmentWorkspace } from "../../src/lib/assignment-admin-contracts";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("administrator reassigns selected doors with explicit confirmation, reload-safe retry and preserved history (mock transport)", async ({
  page,
}) => {
  const workspace: AssignmentWorkspace = {
    campaignId: id(1),
    endAt: "2030-05-02T03:59:59Z",
    deletionAt: "2030-06-01T03:59:59Z",
    reassignmentReady: true,
    households: [
      {
        id: id(2),
        buildingId: id(5),
        address: "100 FIXTURE WALK",
        unit: "2A",
        ward: "A",
        peopleCount: 2,
        suppressed: false,
      },
      {
        id: id(3),
        buildingId: id(5),
        address: "100 FIXTURE WALK",
        unit: "10B",
        ward: "A",
        peopleCount: 1,
        suppressed: false,
      },
      {
        id: id(4),
        buildingId: id(5),
        address: "100 FIXTURE WALK",
        unit: "11C",
        ward: "A",
        peopleCount: 1,
        suppressed: true,
      },
    ],
    events: [
      { id: id(6), name: "Practice event", endsAt: "2030-04-20T21:00:00Z" },
    ],
    assignments: [
      {
        id: id(7),
        eventId: id(6),
        name: "Practice A",
        kind: "building",
        householdIds: [id(2), id(3), id(4)],
        supersededHouseholdIds: [],
      },
    ],
  };
  const calls: unknown[] = [];
  let lost = true,
    conflict = false;
  await page.route("**/api/admin/**", async (route) => {
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
              id: id(1),
              name: "Synthetic: Reassignment",
              endAt: workspace.endAt,
              deletionAt: workspace.deletionAt,
              importReady: true,
              assignmentsReady: true,
              importReceipt: {
                campaignId: id(1),
                importId: id(8),
                finalizedAt: "2026-09-15T00:00:00Z",
                counts: { people: 4, households: 3, buildings: 1 },
              },
            },
          ],
        },
      });
    expect(path).toBe("/api/admin/assignments");
    const input = route.request().postDataJSON();
    if (input.action === "workspace")
      return route.fulfill({ json: { workspace } });
    expect(input.action).toBe("reassign");
    expect(input.confirmed).toBe(true);
    calls.push(input);
    if (conflict)
      return route.fulfill({
        status: 409,
        json: { error: "Selected doors changed. Refresh assignments." },
      });
    if (!workspace.assignments.some((a) => a.id === input.id)) {
      const source = workspace.assignments[0];
      source.householdIds = source.householdIds.filter(
        (h) => !input.householdIds.includes(h),
      );
      source.supersededHouseholdIds!.push(...input.householdIds);
      workspace.assignments.push({
        id: input.id,
        eventId: source.eventId,
        name: input.name,
        kind: source.kind,
        householdIds: input.householdIds,
        supersededHouseholdIds: [],
      });
    }
    if (lost) {
      lost = false;
      return route.abort("failed");
    }
    return route.fulfill({ json: { workspace, savedId: input.id } });
  });
  await page.goto("/admin");
  const region = page.getByRole("region", {
    name: "Event and assignment preparation",
  });
  const source = region
    .locator(".saved-assignment")
    .filter({ has: page.getByText("Practice A", { exact: true }) });
  await source.getByText("Reassign doors", { exact: true }).click();
  const form = page.getByRole("form", {
    name: "Reassign doors from Practice A",
  });
  await expect(form.getByRole("checkbox", { name: /11C/ })).toBeDisabled();
  await expect(
    form.getByRole("button", { name: "Move selected doors" }),
  ).toBeDisabled();
  await form.getByRole("checkbox", { name: /Unit 10B/ }).check();
  await form.getByLabel("New assignment / volunteer label").fill("Practice B");
  await expect(
    form.getByRole("button", { name: "Move selected doors" }),
  ).toBeDisabled();
  await form
    .getByRole("checkbox", { name: /Move this 1 selected door/ })
    .check();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await source.screenshot({
    path: `test-results/reassignment-${test.info().project.name}.png`,
  });
  await form.getByRole("button", { name: "Move selected doors" }).click();
  await expect(
    region.getByRole("button", { name: "Retry pending save" }),
  ).toBeEnabled();
  await page.reload();
  await expect(region.getByText("Practice B", { exact: true })).toBeVisible();
  await region.getByRole("button", { name: "Retry pending save" }).click();
  await expect(
    region.getByRole("status").filter({ hasText: "Doors reassigned" }),
  ).toBeFocused();
  expect(calls[0]).toEqual(calls[1]);
  expect(workspace.assignments).toHaveLength(2);
  expect(workspace.assignments[0].householdIds).toEqual([id(2), id(4)]);
  expect(workspace.assignments[1].householdIds).toEqual([id(3)]);
  await source.getByText("Reassigned doors (1)", { exact: true }).click();
  await expect(
    source.getByText("100 FIXTURE WALK · Unit 10B", { exact: true }),
  ).toBeVisible();
  await source.getByText("Reassign doors", { exact: true }).click();
  await expect(form.getByRole("checkbox", { name: /Unit 10B/ })).toHaveCount(0);
  await form.getByRole("checkbox", { name: /Unit 2A/ }).check();
  await form.getByLabel("New assignment / volunteer label").fill("Practice C");
  await form
    .getByRole("checkbox", { name: /Move this 1 selected door/ })
    .check();
  conflict = true;
  await form.getByRole("button", { name: "Move selected doors" }).click();
  await expect(region.getByRole("alert")).toContainText(
    "Selected doors changed",
  );
  expect(workspace.assignments).toHaveLength(2);
  await page.reload();
  await expect(
    region.getByRole("button", { name: "Retry pending save" }),
  ).toHaveCount(0);
  await expect(region.getByText("Practice B", { exact: true })).toBeVisible();
});

test("refreshed reassigned doors disappear without losing offline records; empty assignments remain syncable (native mock transport)", async ({
  page,
  context,
}) => {
  const assignment: Assignment = {
    id: id(1),
    campaignId: id(2),
    name: "Practice A",
    eventName: "Practice event",
    eventEndsAt: "2030-05-01T21:00:00Z",
    deletionAt: "2030-06-01T21:00:00Z",
    synthetic: true,
    programs: [],
    supersededHouseholdIds: [],
    households: [
      {
        id: id(3),
        buildingId: id(4),
        address: "100 FIXTURE WALK",
        unit: "2A",
        suppressed: false,
        people: [{ id: id(5), firstName: "Resident A", lastName: "Fixture" }],
      },
      {
        id: id(6),
        buildingId: id(4),
        address: "100 FIXTURE WALK",
        unit: "10B",
        suppressed: false,
        people: [{ id: id(7), firstName: "Resident B", lastName: "Fixture" }],
      },
    ],
  };
  const received = new Map<string, Operation>();
  let disconnected = false;
  const proxy = createServer(async (req, res) => {
    if (disconnected) {
      req.socket.destroy();
      return;
    }
    if (req.url === "/api/assignment") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(assignment));
      return;
    }
    if (req.url === "/api/operations") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const op: Operation = JSON.parse(Buffer.concat(chunks).toString());
      received.set(op.id, op);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          operationId: op.id,
          receivedAt: "2026-09-15T22:30:00Z",
        }),
      );
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
    await page.goto(`${origin}/field#key=${"r".repeat(43)}`);
    await page
      .getByRole("button", { name: "Download assignment", exact: true })
      .click();
    await expect(
      page.getByText("Ready offline", { exact: true }),
    ).toBeVisible();
    disconnected = true;
    await page.getByRole("button", { name: /Unit 2A/ }).click();
    await page.getByLabel("No answer", { exact: true }).check();
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(
      page.getByText("1 waiting to sync", { exact: true }),
    ).toBeVisible();
    assignment.households = assignment.households.filter((h) => h.id !== id(3));
    assignment.supersededHouseholdIds = [id(3)];
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${origin}/field`);
    await expect(
      reopened.getByText("1 waiting to sync", { exact: true }),
    ).toBeVisible();
    await expect(
      reopened.getByRole("button", { name: /Unit 2A/ }),
    ).toBeVisible();
    disconnected = false;
    await reopened
      .getByRole("button", { name: "Refresh assignment", exact: true })
      .click();
    await expect(
      reopened.getByText(/1 door has been reassigned/),
    ).toBeVisible();
    await expect(reopened.getByRole("button", { name: /Unit 2A/ })).toHaveCount(
      0,
    );
    await expect(
      reopened.getByText("0 of 1 households recorded", { exact: true }),
    ).toBeVisible();
    await expect(
      reopened.getByText("1 waiting to sync", { exact: true }),
    ).toBeVisible();
    // Save a second real visit before all doors move.
    await reopened.getByRole("button", { name: /Unit 10B/ }).click();
    await reopened.getByLabel("No answer", { exact: true }).check();
    await reopened.getByRole("button", { name: "Save & next" }).click();
    await expect(
      reopened.getByText("2 waiting to sync", { exact: true }),
    ).toBeVisible();
    // A second tab may still hold a draft for a door removed by this tab's refresh.
    const stale = await context.newPage();
    await stale.goto(`${origin}/field`);
    await stale.getByRole("button", { name: /Unit 10B/ }).click();
    await stale.getByLabel("No answer", { exact: true }).check();
    assignment.households = [];
    assignment.supersededHouseholdIds = [id(3), id(6)];
    await reopened
      .getByRole("button", { name: "Refresh assignment", exact: true })
      .click();
    await expect(reopened.getByText(/No active doors remain/)).toBeVisible();
    await stale.getByRole("button", { name: "Save & next" }).click();
    await expect(
      stale.getByText(/no longer in your active assignment/),
    ).toBeVisible();
    await stale.close();
    await expect(
      reopened.getByText("0 of 0 households recorded", { exact: true }),
    ).toBeVisible();
    await expect(reopened.getByText(/NaN|Infinity/)).toHaveCount(0);
    await reopened.reload();
    await expect(
      reopened.getByText("2 waiting to sync", { exact: true }),
    ).toBeVisible();
    await reopened
      .getByRole("button", { name: "Sync now", exact: true })
      .click();
    await expect(
      reopened.getByText("All records received", { exact: true }),
    ).toBeVisible();
    expect(received.size).toBe(2);
    expect(
      [...received.values()].map((op) =>
        op.kind === "visit" ? op.householdId : null,
      ),
    ).toEqual([id(3), id(6)]);
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});
