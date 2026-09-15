import { test, expect } from "@playwright/test";
import type { AssignmentWorkspace } from "../../src/lib/assignment-admin-contracts";

test("organizer chooses doors, retries an ambiguous save and restores assignments (mock transport)", async ({
  page,
}) => {
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const campaignId = id(1);
  const workspace: AssignmentWorkspace = {
    campaignId,
    endAt: "2030-05-02T03:59:59Z",
    deletionAt: "2030-06-01T03:59:59Z",
    households: [
      {
        id: id(2),
        buildingId: id(5),
        address: "100 Practice Avenue",
        unit: "2A",
        ward: "A",
        peopleCount: 2,
        suppressed: false,
      },
      {
        id: id(3),
        buildingId: id(5),
        address: "100 Practice Avenue",
        unit: "10B",
        ward: "A",
        peopleCount: 1,
        suppressed: false,
      },
      {
        id: id(4),
        buildingId: id(6),
        address: "200 Practice Avenue",
        unit: "",
        ward: "A",
        peopleCount: 1,
        suppressed: false,
      },
    ],
    events: [],
    assignments: [],
  };
  let attempts = 0;
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session"))
      return route.fulfill({
        json: { administrator: { id: id(9), email: "organizer@example.test" } },
      });
    if (path.endsWith("/campaigns"))
      return route.fulfill({
        json: {
          campaigns: [
            {
              id: campaignId,
              name: "Synthetic: Assignment practice",
              endAt: workspace.endAt,
              deletionAt: workspace.deletionAt,
              importReady: true,
              assignmentsReady: true,
              importReceipt: {
                campaignId,
                importId: id(8),
                finalizedAt: "2026-09-15T00:00:00Z",
                counts: { people: 4, households: 3, buildings: 2 },
              },
            },
          ],
        },
      });
    expect(path).toBe("/api/admin/assignments");
    const input = route.request().postDataJSON();
    expect(input.campaignId).toBe(campaignId);
    if (input.action === "workspace")
      return route.fulfill({ json: { workspace } });
    if (input.action === "event") {
      workspace.events.push({
        id: input.id,
        name: input.name,
        endsAt: `${input.endDate}T21:00:00Z`,
      });
    } else {
      attempts++;
      if (!workspace.assignments.some((a) => a.id === input.id))
        workspace.assignments.push({
          id: input.id,
          eventId: input.eventId,
          name: input.name,
          kind: input.kind,
          householdIds: input.householdIds,
        });
      if (attempts === 1) return route.abort("failed");
    }
    return route.fulfill({ json: { workspace, savedId: input.id } });
  });
  await page.goto("/admin");
  const section = page.getByRole("region", {
    name: "Event and assignment preparation",
  });
  await expect(
    section.getByText("0 events · 0 saved assignments"),
  ).toBeVisible();
  await section
    .getByRole("button", { name: "Create assignment", exact: true })
    .click();
  await page
    .getByLabel("Event name", { exact: true })
    .fill("Saturday practice");
  await page.getByLabel("Event end date").fill("2030-04-20");
  await section
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(
    section.getByText("Event saved. Choose its households below."),
  ).toBeVisible();
  await page
    .getByLabel("Assignment / volunteer label")
    .fill("Practice Volunteer A");
  await section.getByRole("checkbox", { name: /Unit 10B/ }).check();
  await section.getByRole("checkbox", { name: /Unit 2A/ }).check();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => ({
      inner: innerWidth,
      scroll: document.documentElement.scrollWidth,
      x: scrollX,
      elements: Array.from(document.querySelectorAll("*"))
        .filter(
          (el) =>
            el.getBoundingClientRect().right > innerWidth ||
            el.scrollWidth > el.clientWidth + 1,
        )
        .map((el) => ({
          tag: el.tagName,
          class: el.className,
          right: el.getBoundingClientRect().right,
          width: el.getBoundingClientRect().width,
          scroll: el.scrollWidth,
          client: el.clientWidth,
          type: el.getAttribute("type"),
          label:
            el.tagName === "LABEL" ? el.textContent?.slice(0, 100) : undefined,
        })),
    }));
    await page.screenshot({
      path: `test-results/assignment-width-${width}-${test.info().project.name}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      JSON.stringify(overflow),
    ).toBeTruthy();
  }
  await section.screenshot({
    path: `test-results/assignment-builder-${test.info().project.name}.png`,
  });
  await section
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "Retry pending save" }),
  ).toBeEnabled();
  expect(workspace.assignments[0].householdIds).toEqual([id(2), id(3)]);
  await page.reload();
  await expect(
    section.getByText("Practice Volunteer A", { exact: true }),
  ).toBeVisible();
  await section.getByRole("button", { name: "Retry pending save" }).click();
  await expect(
    section.getByText(
      "Assignment saved. Private volunteer links are not connected yet.",
    ),
  ).toBeVisible();
  expect(workspace.assignments).toHaveLength(1);
  await expect(
    section.getByRole("checkbox", { name: /Unit 2A/ }),
  ).toBeDisabled();
  await expect(
    section.getByRole("checkbox", { name: /Unit 10B/ }),
  ).toBeDisabled();
  await section.getByText("Create another event", { exact: true }).click();
  await page.getByLabel("Event name", { exact: true }).fill("Second practice");
  await page.getByLabel("Event end date").fill("2030-04-21");
  await section
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await page
    .getByLabel("Assignment / volunteer label")
    .fill("Practice Volunteer B");
  await page.getByLabel("Assignment type").selectOption("scattered");
  await section.getByRole("checkbox", { name: /Unit 2A/ }).check();
  await section.getByRole("checkbox", { name: /200 Practice/ }).check();
  await section.getByRole("button", { name: "Move door 2 up" }).click();
  await section
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await expect(
    section.getByText("2 events · 2 saved assignments"),
  ).toBeVisible();
  expect(workspace.assignments[1].householdIds).toEqual([id(4), id(2)]);
  await page.reload();
  await expect(
    section.getByText("Practice Volunteer A", { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByText("Practice Volunteer B", { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Create assignment", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((k) =>
        k.startsWith("jco-assignment-save:"),
      ),
    ),
  ).toBe(false);
  await section.screenshot({
    path: `test-results/assignments-saved-${test.info().project.name}.png`,
  });
});
