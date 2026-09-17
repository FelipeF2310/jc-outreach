import { test, expect } from "@playwright/test";
import type { AssignmentWorkspace } from "../../src/lib/assignment-admin-contracts";
import type { FieldSnapshot } from "../../src/lib/field-admin-contracts";

test("one campaign workspace keeps setup compact, preserves drafts and scopes received results (mock transport)", async ({
  page,
}) => {
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const workspace: AssignmentWorkspace = {
    campaignId: id(1),
    endAt: "2030-10-13T03:59:59Z",
    deletionAt: "2030-11-12T04:59:59Z",
    households: [
      {
        id: id(3),
        buildingId: id(4),
        address: "100 FIXTURE WALK",
        unit: "2A",
        ward: "A",
        peopleCount: 2,
        suppressed: false,
      },
      {
        id: id(11),
        buildingId: id(4),
        address: "100 FIXTURE WALK",
        unit: "10B",
        ward: "A",
        peopleCount: 1,
        suppressed: false,
      },
    ],
    events: [
      { id: id(5), name: "Saturday practice", endsAt: "2030-10-01T21:00:00Z" },
      { id: id(10), name: "Sunday practice", endsAt: "2030-10-02T21:00:00Z" },
    ],
    assignments: [
      {
        id: id(6),
        eventId: id(5),
        name: "Practice Volunteer A",
        kind: "building",
        householdIds: [id(3)],
      },
      {
        id: id(7),
        eventId: id(10),
        name: "Practice Volunteer B",
        kind: "building",
        householdIds: [id(3), id(11)],
      },
    ],
  };
  let failSecond = true;
  let missingRecords = 1;
  let mutations = 0;
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
              id: id(2),
              name: "Synthetic: Next campaign",
              endAt: workspace.endAt,
              deletionAt: workspace.deletionAt,
              importReady: true,
            },
            {
              id: id(1),
              name: "Synthetic: Ward A Practice",
              endAt: workspace.endAt,
              deletionAt: workspace.deletionAt,
              importReady: true,
              assignmentsReady: true,
              fieldReady: true,
              importReceipt: {
                campaignId: id(1),
                importId: id(8),
                finalizedAt: "2026-09-15T00:00:00Z",
                counts: { people: 3, households: 2, buildings: 1 },
              },
            },
          ],
        },
      });
    const input = route.request().postDataJSON();
    if (path.endsWith("/help"))
      return route.fulfill({
        json: {
          queue: { campaignId: input.campaignId, ready: false, requests: [] },
        },
      });
    if (path.endsWith("/assignments")) {
      expect(input).toEqual({ action: "workspace", campaignId: id(1) });
      return route.fulfill({ json: { workspace } });
    }
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
    if (input.action !== "status") mutations++;
    expect(input.action).toBe("status");
    if (input.assignmentId === id(7) && failSecond)
      return route.fulfill({
        status: 503,
        json: { error: "Results temporarily unavailable." },
      });
    const snapshot: FieldSnapshot = {
      completion: {
        completionReady: true,
        devices: [
          {
            deviceId: id(40),
            label: "Practice link A",
            state: "finished",
            version: 1,
            receivedAt: "2026-09-15T20:00:00Z",
            declaredCount: 1,
            pendingReportedCount: 1,
            missingCount: missingRecords,
            additionalActivity: false,
          },
        ],
      },
      assignmentId: input.assignmentId,
      eventEndsAt: workspace.events[0].endsAt,
      uploadEndsAt: "2030-10-04T21:00:00Z",
      deletionAt: workspace.deletionAt,
      credentials: [],
      visits: workspace.households
        .slice(0, input.assignmentId === id(6) ? 1 : 2)
        .map((h, index) => ({
          id: id(20 + index),
          address: h.address,
          unit: h.unit,
          result: "no_answer",
          receivedAt: "2026-09-15T20:00:00Z",
        })),
      counts: {
        attempts: input.assignmentId === id(6) ? 1 : 2,
        conversations: 0,
        repeats: 0,
      },
      buildingFailures: 0,
      helpRequests: 0,
      latestReceivedAt: "2026-09-15T20:00:00Z",
    };
    return route.fulfill({ json: { snapshot } });
  });
  await page.goto("/admin");
  const campaign = page.getByLabel("Current campaign", { exact: true });
  const assignments = page.getByRole("region", {
    name: "Event and assignment preparation",
    exact: true,
  });
  const results = page.getByRole("region", {
    name: "Results and follow-up",
    exact: true,
  });
  await expect(campaign).toHaveValue(id(1));
  await expect(
    page.getByRole("heading", { name: "Household list", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Campaign name", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByLabel("Event name", { exact: true }),
  ).not.toBeVisible();
  await expect(page.getByLabel("Synthetic CSV example")).not.toBeVisible();
  await expect(
    assignments.getByText("Practice Volunteer A", { exact: true }),
  ).toBeVisible();
  await expect(
    results
      .locator(".stat")
      .filter({ hasText: "Households attempted" })
      .locator("strong"),
  ).toHaveText("1");
  const completion = results.getByRole("region", {
    name: "Received walk completion",
  });
  await expect(
    completion.getByText("Field work finished — records still missing", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    completion.getByText(/New offline work is unknown/),
  ).toBeVisible();
  missingRecords = 0;
  await results
    .getByRole("button", { name: "Refresh results", exact: true })
    .click();
  await expect(
    completion.getByText("Finished and synchronized", { exact: true }),
  ).toBeVisible();
  await expect(
    completion.getByText(/Device reported 1 pending at last contact/),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Automatic deletion is not connected yet. Its database update and scheduler setup are still required. Synthetic testing only.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    results.getByText(/Resident correction review needs its database update/),
  ).toBeVisible();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/admin-workspace-${width}-${test.info().project.name}.png`,
      fullPage: true,
    });
  }
  await assignments
    .getByRole("button", { name: "Create assignment", exact: true })
    .click();
  await expect(assignments.locator(".assignment-builder")).toBeFocused();
  await page
    .getByLabel("Assignment / volunteer label")
    .fill("Unfinished practice draft");
  await campaign.selectOption(id(2));
  await expect(assignments).not.toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Import synthetic households",
      exact: true,
    }),
  ).toBeVisible();
  await campaign.selectOption(id(1));
  await expect(page.getByLabel("Assignment / volunteer label")).toHaveValue(
    "Unfinished practice draft",
  );
  await assignments
    .getByRole("button", { name: "Close assignment builder" })
    .click();
  await results.getByLabel("Results for assignment").selectOption(id(7));
  await expect(results.getByRole("alert")).toContainText(
    "Results temporarily unavailable",
  );
  await expect(results.locator(".stat")).toHaveCount(0);
  failSecond = false;
  await results.getByRole("button", { name: "Retry results" }).click();
  await expect(
    results
      .locator(".stat")
      .filter({ hasText: "Households attempted" })
      .locator("strong"),
  ).toHaveText("2");
  await assignments
    .locator(".saved-assignment")
    .filter({ has: page.getByText("Practice Volunteer A", { exact: true }) })
    .getByRole("link", { name: "View results", exact: true })
    .click();
  await expect(results.getByLabel("Results for assignment")).toHaveValue(id(6));
  await expect(
    results
      .locator(".stat")
      .filter({ hasText: "Households attempted" })
      .locator("strong"),
  ).toHaveText("1");
  await campaign.selectOption(id(2));
  await page.reload();
  await expect(campaign).toHaveValue(id(2));
  await expect(assignments).not.toBeVisible();
  expect(mutations).toBe(0);
});
