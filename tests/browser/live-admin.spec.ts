import { test, expect } from "@playwright/test";

test("live campaign shows all ten preloaded pairs without practice labeling (synthetic mock transport)", async ({
  page,
}) => {
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const campaignId = id(1);
  const counts = [37, 37, 37, 38, 37, 38, 37, 38, 37, 38];
  const households = Array.from({ length: 374 }, (_, i) => ({
    id: id(1000 + i),
    buildingId: id(2000 + i),
    address: `${i + 1} SYNTHETIC TEST WALK`,
    unit: "",
    ward: "A",
    peopleCount: i === 0 ? 2 : 1,
    people:
      i === 0
        ? [
            { firstName: "Resident Alpha", lastName: "Fixture" },
            { firstName: "Resident Beta", lastName: "Fixture" },
          ]
        : [
            {
              firstName:
                i === 1 ? "Resident <em>Literal</em>" : `Resident ${i}`,
              lastName: i === 2 ? "LongFixture".repeat(20) : "Fixture",
            },
          ],
    suppressed: false,
  }));
  let offset = 0;
  const assignments = counts.map((count, i) => {
    const householdIds = households
      .slice(offset, offset + count)
      .map((h) => h.id);
    offset += count;
    return {
      id: id(100 + i),
      eventId: id(2),
      name: `Pair ${String(i + 1).padStart(2, "0")}`,
      kind: "scattered",
      householdIds,
    };
  });
  const workspace = {
    campaignId,
    endAt: "2030-10-19T03:59:59Z",
    deletionAt: "2030-11-18T04:59:59Z",
    households,
    assignments,
    events: [
      {
        id: id(2),
        name: "Paired outreach test",
        endsAt: "2030-10-18T21:00:00Z",
      },
    ],
  };
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session"))
      return route.fulfill({
        json: { administrator: { id: id(9), email: "organizer@example.test" } },
      });
    if (path.endsWith("/retention"))
      return route.fulfill({ json: { retention: { ready: false } } });
    if (path.endsWith("/campaigns"))
      return route.fulfill({
        json: {
          live: true,
          campaigns: [
            {
              id: id(3),
              name: "Synthetic: Existing practice",
              dataKind: "synthetic",
              importReady: true,
              endAt: workspace.endAt,
              deletionAt: workspace.deletionAt,
            },
            {
              id: campaignId,
              name: "Ward A Benefits Outreach",
              dataKind: "live",
              endAt: workspace.endAt,
              deletionAt: workspace.deletionAt,
              importReady: true,
              assignmentsReady: true,
              fieldReady: true,
              importReceipt: {
                campaignId,
                importId: id(4),
                finalizedAt: "2026-09-18T00:00:00Z",
                counts: { people: 473, households: 374, buildings: 358 },
              },
            },
          ],
        },
      });
    if (path.endsWith("/assignments"))
      return route.fulfill({ json: { workspace } });
    if (path.endsWith("/field"))
      return route.fulfill({
        json: {
          snapshot: {
            assignmentId: route.request().postDataJSON().assignmentId,
            labelsReady: true,
            eventEndsAt: workspace.events[0].endsAt,
            uploadEndsAt: "2030-10-21T21:00:00Z",
            deletionAt: workspace.deletionAt,
            credentials: [],
            visits: [],
            counts: { attempts: 0, repeats: 0, conversations: 0 },
            buildingFailures: 0,
            helpRequests: 0,
            latestReceivedAt: null,
          },
        },
      });
    if (path.endsWith("/help"))
      return route.fulfill({
        json: { queue: { campaignId, ready: false, requests: [] } },
      });
    if (path.endsWith("/corrections"))
      return route.fulfill({
        json: { queue: { campaignId, ready: false, reports: [] } },
      });
    return route.abort();
  });
  await page.goto("/admin");
  await expect(
    page.getByLabel("Current campaign", { exact: true }),
  ).toHaveValue(campaignId);
  await expect(page.getByText(/Resident outreach ·/)).toBeVisible();
  await expect(
    page.getByText("1 events · 10 saved assignments", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".saved-assignment")).toHaveCount(10);
  for (let i = 0; i < 10; i++)
    await expect(page.locator(".saved-assignment").nth(i)).toContainText(
      `${assignments[i].name} · ${counts[i]} doors`,
    );
  const doors = page
    .locator(".saved-assignment")
    .first()
    .locator(".assignment-doors");
  await expect(
    doors.getByText("Resident Alpha Fixture", { exact: true }),
  ).not.toBeVisible();
  await doors.locator("summary").click();
  await expect(
    doors.getByText("Resident Alpha Fixture", { exact: true }),
  ).toBeVisible();
  await expect(
    doors.getByText("Resident Beta Fixture", { exact: true }),
  ).toBeVisible();
  await expect(
    doors.getByText("1 SYNTHETIC TEST WALK", { exact: true }),
  ).toHaveCount(1);
  await expect(
    doors.getByText("Resident <em>Literal</em> Fixture", { exact: true }),
  ).toBeVisible();
  await expect(doors.locator("em")).toHaveCount(0);
  const links = page.getByRole("region", {
    name: "Volunteer links for Pair 01",
    exact: true,
  });
  await links
    .getByRole("button", { name: "Volunteer links", exact: true })
    .click();
  await expect(links.getByLabel("Volunteer / link name")).toHaveValue(
    "Pair 01",
  );
  await expect(
    links.getByRole("button", { name: "Generate private link" }),
  ).toBeEnabled();
  await expect(links).not.toContainText("Synthetic testing only");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("Resident Alpha");
  await page
    .getByRole("button", { name: "Create assignment", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic preparation only.", { exact: false }),
  ).not.toBeVisible();
  await expect(page.getByLabel("Assignment / volunteer label")).toHaveValue("");
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await doors
      .locator(".assigned-door")
      .first()
      .screenshot({
        path: `test-results/resident-card-${test.info().project.name}-${width}.png`,
      });
  }
  await page.getByRole("button", { name: "Close assignment builder" }).click();
  await page.screenshot({
    path: `test-results/live-admin-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByText("1 events · 10 saved assignments", { exact: true }),
  ).toBeVisible();
  await doors.locator("summary").click();
  await expect(
    doors.getByText("Resident Alpha Fixture", { exact: true }),
  ).toBeVisible();
  await expect(
    doors.getByText("Resident Beta Fixture", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Current campaign", { exact: true })
    .selectOption(id(3));
  await expect(
    page.getByRole("button", { name: "Import synthetic households" }),
  ).toBeVisible();
});
