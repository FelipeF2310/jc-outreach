import { test, expect } from "@playwright/test";
import type { RetentionStatus } from "../../src/lib/retention-contracts";

test("an open administrator tab unmounts expired campaign data without waiting for a server refresh", async ({
  page,
}) => {
  const now = new Date("2026-09-17T20:00:00Z");
  await page.clock.install({ time: now });
  const id = "00000000-0000-4000-8000-000000000001";
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session"))
      return route.fulfill({
        json: { administrator: { id, email: "organizer@example.test" } },
      });
    if (path.endsWith("/campaigns"))
      return route.fulfill({
        json: {
          campaigns: [
            {
              id,
              name: "Synthetic: Expiring campaign",
              endAt: "2026-08-18T20:00:10Z",
              deletionAt: "2026-09-17T20:00:10Z",
              importReady: false,
            },
          ],
        },
      });
    expect(path).toBe("/api/admin/retention");
    return route.fulfill({ json: { retention: { ready: false } } });
  });
  await page.goto("/admin");
  await expect(
    page.getByRole("combobox", { name: "Current campaign" }),
  ).toHaveValue(id);
  await expect(
    page.locator(`[aria-label="Workspace for Synthetic: Expiring campaign"]`),
  ).toBeVisible();
  await page.clock.fastForward(11_000);
  await expect(
    page.getByRole("combobox", { name: "Current campaign" }),
  ).toHaveCount(0);
  await expect(
    page.locator(`[aria-label="Workspace for Synthetic: Expiring campaign"]`),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Campaign data retention" }),
  ).toBeVisible();
});

test("retention shows setup, failed/stale checks, warnings and recovery even without active campaigns (mock transport)", async ({
  page,
}, testInfo) => {
  const id = "00000000-0000-4000-8000-000000000001";
  const ready = {
    ready: true as const,
    observedAt: "2026-09-17T20:00:00Z",
    checkedAt: null,
    health: "not_started" as const,
    deletedCampaigns: 0,
    overdueCampaigns: 0,
    failedCampaigns: 0,
    oldestDeadline: null,
    selected: null,
  };
  let retention: RetentionStatus = { ready: false };
  let available = true,
    activeCampaign = true;
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session"))
      return route.fulfill({
        json: { administrator: { id, email: "organizer@example.test" } },
      });
    if (path.endsWith("/campaigns"))
      return route.fulfill({
        json: {
          campaigns: activeCampaign
            ? [
                {
                  id,
                  name: "Synthetic: Retention practice",
                  endAt: "2030-10-13T03:59:59Z",
                  deletionAt: "2030-11-12T04:59:59Z",
                  importReady: false,
                },
              ]
            : [],
        },
      });
    expect(path).toBe("/api/admin/retention");
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      campaignId: activeCampaign ? id : null,
    });
    return available
      ? route.fulfill({ json: { retention } })
      : route.fulfill({ status: 503, json: { error: "Unavailable" } });
  });
  await page.goto("/admin");
  const panel = page.getByRole("region", {
    name: "Campaign data retention",
    exact: true,
  });
  const refresh = () =>
    panel
      .getByRole("button", { name: "Refresh deletion status", exact: true })
      .click();
  await expect(
    panel.getByText(/Automatic deletion is not connected yet/),
  ).toBeVisible();
  retention = ready;
  await refresh();
  await expect(panel.getByText(/no completed check yet/)).toBeVisible();
  retention = {
    ...ready,
    health: "recent",
    checkedAt: "2026-09-17T20:00:00Z",
    selected: {
      campaignId: id,
      deletionAt: "2030-11-12T04:59:59Z",
      openHelpRequests: 4,
    },
  };
  await refresh();
  await expect(
    panel.getByText(/4 unresolved application-help requests/),
  ).toBeVisible();
  await expect(panel.getByText(/No overdue campaign data/)).toBeVisible();
  available = false;
  await refresh();
  await expect(panel.getByRole("alert")).toContainText(
    "Do not assume cleanup has run",
  );
  await expect(panel.getByText(/No overdue campaign data/)).toHaveCount(0);
  available = true;
  activeCampaign = false;
  retention = {
    ...ready,
    health: "recent",
    checkedAt: "2026-09-17T20:00:00Z",
    overdueCampaigns: 1,
    failedCampaigns: 1,
    oldestDeadline: "2026-09-17T19:59:00Z",
  };
  await page
    .getByRole("button", { name: "Refresh campaigns", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Campaign deletion failed",
  );
  await expect(
    page.getByRole("combobox", { name: "Current campaign" }),
  ).toHaveCount(0);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.screenshot({
    path: testInfo.outputPath("retention-failure.png"),
  });
  retention = { ...ready, health: "stale", checkedAt: "2026-09-17T19:00:00Z" };
  await refresh();
  await expect(panel.getByRole("alert")).toContainText(
    "Deletion checks are overdue",
  );
  retention = {
    ...ready,
    health: "recent",
    checkedAt: "2026-09-17T20:01:00Z",
    deletedCampaigns: 1,
  };
  await refresh();
  await expect(panel.getByRole("status")).toContainText(
    "No overdue campaign data",
  );
  await page.reload();
  await expect(panel.getByRole("status")).toContainText(
    "No overdue campaign data",
  );
  await panel.getByText("What deletion covers", { exact: true }).click();
  await expect(
    panel.getByText(
      /not backups, administrator exports or disconnected phones/,
    ),
  ).toBeVisible();
  await expect(
    panel.getByText(/Campaigns removed by this worker: 1/),
  ).toBeVisible();
});
