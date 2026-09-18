import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("organizer rejects a bad CSV, previews a valid one, finalizes and walks imported doors", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("region", {
    name: "One list. The right doors.",
  });
  await panel.getByRole("button", { name: "New import rehearsal" }).click();
  await panel
    .getByRole("combobox", { name: "CSV example", exact: true })
    .selectOption("tier-three");
  await panel.getByRole("button", { name: "Validate synthetic CSV" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Import rejected — no resident rows stored",
  );
  await expect(panel.getByRole("alert")).not.toContainText("Resident A");
  await expect(
    panel.getByRole("button", { name: "Finalize import", exact: true }),
  ).not.toBeVisible();
  await panel
    .getByRole("combobox", { name: "CSV example", exact: true })
    .selectOption("valid-couple-and-buildings");
  await panel.getByRole("button", { name: "Validate synthetic CSV" }).click();
  await expect(
    panel.getByText("Validation passed — not yet imported", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("4 people · 3 households · 2 buildings", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Finalize import", exact: true }),
  ).toBeDisabled();
  await panel
    .getByLabel(
      "I reviewed the household grouping and approve this synthetic source.",
    )
    .check();
  await panel
    .getByRole("button", { name: "Finalize import", exact: true })
    .click();
  await expect(
    panel.getByText("Import finalized", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("4 people · 3 households · 2 buildings committed.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    panel.getByText("Import finalized", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/import-${test.info().project.name}.png`,
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Create imported practice assignment" })
    .click();
  const createAssignment = panel.getByRole("button", {
    name: "Create imported practice assignment",
  });
  const openAssignment = panel.getByRole("link", {
    name: "Open imported volunteer assignment",
  });
  await expect(openAssignment).toBeVisible();
  // Both actions need separate tap areas, including when their labels wrap.
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const createBox = (await createAssignment.boundingBox())!;
    const openBox = (await openAssignment.boundingBox())!;
    expect(openBox.y - (createBox.y + createBox.height)).toBeGreaterThanOrEqual(
      12,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.screenshot({
    path: `test-results/import-actions-${test.info().project.name}.png`,
  });
  await panel
    .getByRole("link", { name: "Open imported volunteer assignment" })
    .click();
  await page
    .getByRole("button", { name: "Download assignment", exact: true })
    .click();
  await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Unit 2A/ }).click();
  await expect(
    page.getByText("Resident A Fixture", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Resident B Fixture", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("No answer", { exact: true }).check();
  await page.getByRole("button", { name: "Save & next" }).click();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(
    page.getByText("All records received", { exact: true }),
  ).toBeVisible();
});

test("import API validates separately, refuses raw uploads and returns identical finalization receipts", async ({
  request,
}) => {
  const headers = { "X-JCO-Demo": "1" },
    campaignId = randomUUID();
  expect(
    (
      await request.post("/api/demo/import", {
        headers,
        data: { action: "create", campaignId },
      })
    ).ok(),
  ).toBeTruthy();
  const input = {
    action: "preview",
    campaignId,
    caseId: "valid-couple-and-buildings",
  };
  expect(
    (await request.post("/api/demo/import", { data: input })).status(),
  ).toBe(403);
  for (const extra of [
    { csv: "unapproved raw file" },
    { rows: [{ Tier: "1" }] },
    { valid: true },
  ])
    expect(
      (
        await request.post("/api/demo/import", {
          headers,
          data: { ...input, ...extra },
        })
      ).status(),
    ).toBe(400);
  const preview = await (
    await request.post("/api/demo/import", { headers, data: input })
  ).json();
  expect(preview.valid).toBeTruthy();
  const list = await (
    await request.get("/api/demo/import", { headers })
  ).json();
  expect(
    list.find((row: { campaignId: string }) => row.campaignId === campaignId)
      .receipt,
  ).toBeNull();
  const finalize = { ...input, action: "finalize", digest: preview.digest };
  const [a, b] = await Promise.all([
    request.post("/api/demo/import", { headers, data: finalize }),
    request.post("/api/demo/import", { headers, data: finalize }),
  ]);
  expect(a.ok()).toBeTruthy();
  expect(b.ok()).toBeTruthy();
  expect(await a.json()).toEqual(await b.json());
});

test("a grouping conflict never enables finalization", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByRole("region", {
    name: "One list. The right doors.",
  });
  await panel.getByRole("button", { name: "New import rehearsal" }).click();
  await panel
    .getByRole("combobox", { name: "CSV example", exact: true })
    .selectOption("conflicting-unit");
  await panel.getByRole("button", { name: "Validate synthetic CSV" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "conflicting addresses or units",
  );
  await expect(
    panel.getByRole("button", { name: "Finalize import", exact: true }),
  ).not.toBeVisible();
});
