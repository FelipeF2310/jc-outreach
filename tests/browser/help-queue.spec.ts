import { test, expect } from "@playwright/test";
import type { HelpQueue, HelpUpdate } from "../../src/lib/help-admin-contracts";

test("campaign help queue preserves pending updates, handles conflicts and groups resolved requests (mock transport)", async ({
  page,
}) => {
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const queue: HelpQueue = { campaignId: id(1), ready: false, requests: [] };
  const receipts = new Map<
    string,
    {
      id: string;
      campaignId: string;
      requestId: string;
      status: string;
      version: number;
    }
  >();
  const calls: HelpUpdate[] = [];
  let failRead = false,
    lostAck = true,
    conflict = false,
    denyRead = false;
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
              name: "Synthetic: Help queue",
              endAt: "2030-10-12T03:59:59Z",
              deletionAt: "2030-11-11T04:59:59Z",
              importReady: true,
              assignmentsReady: true,
              fieldReady: true,
              importReceipt: {
                campaignId: id(1),
                importId: id(2),
                counts: { people: 2, households: 2, buildings: 1 },
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
            campaignId: id(1),
            endAt: "2030-10-12T03:59:59Z",
            deletionAt: "2030-11-11T04:59:59Z",
            households: [],
            events: [],
            assignments: [],
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
    expect(path).toBe("/api/admin/help");
    const input = route.request().postDataJSON();
    expect(input.campaignId).toBe(id(1));
    if (input.action === "list") {
      if (denyRead)
        return route.fulfill({
          status: 403,
          json: { error: "Administrator access unavailable." },
        });
      if (failRead)
        return route.fulfill({
          status: 503,
          json: { error: "Help queue temporarily unavailable." },
        });
      return route.fulfill({ json: { queue } });
    }
    expect(input.action).toBe("update");
    calls.push(input);
    const request = queue.requests.find((r) => r.id === input.requestId)!;
    if (conflict) {
      conflict = false;
      request.status = "Resolved";
      request.version++;
      return route.fulfill({
        status: 409,
        json: {
          error: "This request changed. Refresh the queue before trying again.",
        },
      });
    }
    if (!receipts.has(input.id)) {
      expect(input.expectedVersion).toBe(request.version);
      request.status = input.status;
      request.version++;
      request.updatedAt = "2026-09-15T22:00:00Z";
      receipts.set(input.id, {
        id: input.id,
        campaignId: id(1),
        requestId: request.id,
        status: request.status,
        version: request.version,
      });
    }
    if (lostAck) {
      lostAck = false;
      return route.fulfill({
        status: 503,
        json: { error: "Update committed but acknowledgment interrupted." },
      });
    }
    return route.fulfill({ json: { queue, receipt: receipts.get(input.id) } });
  });
  await page.goto("/admin");
  const help = page.getByRole("region", {
    name: "Application-help requests",
    exact: true,
  });
  await expect(help.getByText(/needs its database update/)).toBeVisible();
  queue.ready = true;
  await help
    .getByRole("button", { name: "Refresh help requests", exact: true })
    .click();
  await expect(
    help.getByText(/No application-help requests received yet/),
  ).toBeVisible();
  queue.requests.push(
    {
      id: id(3),
      visitId: id(4),
      assignmentName: "Practice Volunteer A",
      address: "100 FIXTURE WALK",
      unit: "2A",
      requester: null,
      phone: "",
      consent: false,
      arrangement: "return",
      suppressed: false,
      status: "New",
      version: 0,
      receivedAt: "2026-09-15T21:12:48Z",
      updatedAt: null,
    },
    {
      id: id(5),
      visitId: id(6),
      assignmentName: "Practice Volunteer B",
      address: "100 FIXTURE WALK",
      unit: "10B",
      requester: "Resident B Fixture",
      phone: "201-555-0100",
      consent: true,
      arrangement: "unspecified",
      suppressed: true,
      status: "In progress",
      version: 1,
      receivedAt: "2026-09-15T21:15:48Z",
      updatedAt: null,
    },
  );
  await help
    .getByRole("button", { name: "Refresh help requests", exact: true })
    .click();
  const first = help.getByRole("article", {
    name: "Help request for 100 FIXTURE WALK Unit 2A",
    exact: true,
  });
  const second = help.getByRole("article", {
    name: "Help request for 100 FIXTURE WALK Unit 10B",
    exact: true,
  });
  await expect(
    first.getByText("No phone number provided for follow-up."),
  ).toBeVisible();
  await expect(
    first.getByText("Requesting resident not specified"),
  ).toBeVisible();
  await expect(first.getByText("Return visit requested")).toBeVisible();
  await expect(
    second.getByText(/Permission recorded for application-help follow-up/),
  ).toBeVisible();
  await expect(
    second.getByText(/do-not-contact request recorded/),
  ).toBeVisible();
  await first
    .getByText("Source visit & update details", { exact: true })
    .click();
  await expect(
    first.getByText(/Assignment: Practice Volunteer A/),
  ).toBeVisible();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await help.screenshot({
    path: `test-results/help-queue-${test.info().project.name}.png`,
  });
  failRead = true;
  await help
    .getByRole("button", { name: "Refresh help requests", exact: true })
    .click();
  await expect(help.getByRole("alert")).toContainText(
    "Previously loaded requests may be out of date",
  );
  failRead = false;
  await help
    .getByRole("button", { name: "Retry help requests", exact: true })
    .click();
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new Error("Synthetic storage write failed");
    };
  });
  await first
    .getByRole("button", { name: "Mark in progress", exact: true })
    .click();
  await expect(help.getByRole("alert")).toContainText(
    "Synthetic storage write failed",
  );
  expect(calls).toHaveLength(0);
  await page.reload();
  await expect(
    first.getByRole("button", { name: "Mark in progress", exact: true }),
  ).toBeEnabled();
  await first
    .getByRole("button", { name: "Mark in progress", exact: true })
    .click();
  await expect(
    help.getByRole("button", { name: "Retry pending status update" }),
  ).toBeVisible();
  expect(receipts.size).toBe(1);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
        "201-555-0100",
      ),
    ),
  ).toBe(false);
  await page.reload();
  await expect(first.getByText("In progress", { exact: true })).toBeVisible();
  await expect(
    first.getByRole("button", { name: "Mark resolved", exact: true }),
  ).toBeDisabled();
  await help
    .getByRole("button", { name: "Retry pending status update" })
    .click();
  expect(calls[0]).toEqual(calls[1]);
  expect(receipts.size).toBe(1);
  await expect(
    help.getByRole("status").filter({ hasText: "Status update received" }),
  ).toBeFocused();
  await expect(
    first.getByRole("button", { name: "Mark resolved", exact: true }),
  ).toBeEnabled();
  await first
    .getByRole("button", { name: "Mark resolved", exact: true })
    .press("Enter");
  await expect(
    help.getByText("Resolved requests (1)", { exact: true }),
  ).toBeVisible();
  await expect(first).not.toBeVisible();
  await expect(
    help.getByRole("status").filter({ hasText: "Status update received" }),
  ).toBeFocused();
  await help.getByText("Resolved requests (1)", { exact: true }).click();
  await expect(first.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(first.getByRole("button")).toHaveCount(0);
  conflict = true;
  await second
    .getByRole("button", { name: "Mark resolved", exact: true })
    .click();
  await expect(help.getByRole("alert")).toContainText("This request changed");
  await expect(
    second.getByRole("button", { name: "Mark resolved", exact: true }),
  ).toBeDisabled();
  await help
    .getByRole("button", { name: "Retry help requests", exact: true })
    .click();
  await expect(
    help.getByText("No open help requests.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    help.getByText("Resolved requests (2)", { exact: true }),
  ).toBeVisible();
  await expect(first).not.toBeVisible();
  denyRead = true;
  await help
    .getByRole("button", { name: "Refresh help requests", exact: true })
    .click();
  await expect(help.getByRole("alert")).toContainText(
    "Administrator access unavailable",
  );
  await expect(
    help.getByText("Resolved requests (2)", { exact: true }),
  ).toHaveCount(0);
});
