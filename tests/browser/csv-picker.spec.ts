import { test, expect, type Page } from "@playwright/test";
import { rehearsalCsv } from "../../src/lib/synthetic-csv";
import { validateImport } from "../../src/server/import-validation";
import type { ImportReceipt } from "../../src/lib/import-contracts";

async function prepare(page: Page, loseAcknowledgment = false) {
  const campaignId = "00000000-0000-4000-8000-000000000099";
  let receipt: ImportReceipt | null = null;
  const inputs: { action: string; caseId: string; digest?: string }[] = [];
  let finalizations = 0;
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          administrator: { id: "synthetic", email: "organizer@example.test" },
        },
      });
    if (path.endsWith("/retention"))
      return route.fulfill({ json: { retention: { ready: false } } });
    if (path.endsWith("/campaigns"))
      return route.fulfill({
        json: {
          campaigns: [
            {
              id: campaignId,
              name: "Synthetic: CSV practice",
              endAt: "2030-05-02T03:59:59Z",
              deletionAt: "2030-06-01T03:59:59Z",
              importReady: true,
              importReceipt: receipt,
            },
          ],
        },
      });
    if (!path.endsWith("/import"))
      return route.fulfill({ status: 404, json: {} });
    const input = route.request().postDataJSON();
    expect(Object.keys(input).sort()).toEqual(
      (input.action === "preview"
        ? ["action", "campaignId", "caseId"]
        : ["action", "campaignId", "caseId", "confirmed", "digest"]
      ).sort(),
    );
    expect(input.campaignId).toBe(campaignId);
    inputs.push(input);
    const { preview } = validateImport(rehearsalCsv(input.caseId));
    if (input.action === "preview") return route.fulfill({ json: { preview } });
    expect(preview.valid).toBe(true);
    expect(input.digest).toBe(preview.digest);
    expect(input.confirmed).toBe(true);
    receipt ??= {
      importId: "00000000-0000-4000-8000-000000000098",
      campaignId,
      counts: { people: 4, households: 3, buildings: 2 },
      finalizedAt: "2030-01-01T00:00:00Z",
    };
    if (++finalizations === 1 && loseAcknowledgment)
      return route.abort("failed");
    return route.fulfill({ json: { receipt } });
  });
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Import synthetic households" })
    .click();
  await page.getByLabel("Import source", { exact: true }).selectOption("file");
  return { inputs };
}
const csv = (id = "valid-couple-and-buildings", name = "practice.csv") => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(rehearsalCsv(id)),
});

test("practice CSV picker downloads, validates, locks ambiguous retry and restores finalized receipt (mock transport)", async ({
  page,
}) => {
  const { inputs } = await prepare(page, true);
  const picker = page.getByLabel("Select practice CSV", { exact: true });
  const validate = page.getByRole("button", {
    name: "Validate practice CSV",
    exact: true,
  });
  await expect(validate).toBeDisabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download practice CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "jco-practice-valid-couple-and-buildings.csv",
  );
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(csv().buffer);
  const chooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Choose practice CSV", exact: true })
    .click();
  await (await chooserPromise).setFiles(csv());
  await expect(
    page.getByText(/Practice file recognized: Valid example/),
  ).toBeVisible();
  expect(inputs).toHaveLength(0); // Selection itself performs no upload/preview request.
  await validate.click();
  await expect(page.getByText("ONE DOOR", { exact: true })).toHaveCount(3);
  const approve = page.getByRole("checkbox", {
    name: /I reviewed the households/,
  });
  await expect(approve).not.toBeChecked();
  await approve.check();
  await picker.setInputFiles(csv("tier-three"));
  await expect(
    page.getByText("Validation passed — not yet imported"),
  ).not.toBeVisible();
  await validate.click();
  await expect(
    page.getByText("Import rejected — no records stored"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finalize synthetic import" }),
  ).not.toBeVisible();
  await picker.setInputFiles(csv("conflicting-unit"));
  await validate.click();
  await expect(
    page.getByText("Import rejected — no records stored"),
  ).toBeVisible();
  await picker.setInputFiles(csv());
  await validate.click();
  await expect(approve).not.toBeChecked();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `test-results/practice-csv-${test.info().project.name}.png`,
    fullPage: true,
  });
  await approve.check();
  await page.getByRole("button", { name: "Finalize synthetic import" }).click();
  const retry = page.getByRole("button", { name: "Retry import" });
  await expect(retry).toBeEnabled();
  await expect(picker).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Choose another practice CSV" }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Import source", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Clear file selection" }),
  ).toBeDisabled();
  await retry.click();
  await expect(
    page.getByText("4 people · 3 households · 2 buildings saved."),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("4 people · 3 households · 2 buildings saved."),
  ).toBeVisible();
  expect(inputs.filter((input) => input.action === "finalize")).toHaveLength(2);
  expect(inputs.at(-1)).toEqual(inputs.at(-2));
});

test("unrecognized files stay local, reset approval, and never fall back to a built-in import", async ({
  page,
}) => {
  const { inputs } = await prepare(page);
  const requests: string[] = [];
  page.on("request", (request) =>
    requests.push(request.url() + (request.postData() ?? "")),
  );
  const picker = page.getByLabel("Select practice CSV", { exact: true });
  const validate = page.getByRole("button", {
    name: "Validate practice CSV",
    exact: true,
  });
  await picker.setInputFiles(csv());
  await validate.click();
  await page
    .getByRole("checkbox", { name: /I reviewed the households/ })
    .check();
  await picker.setInputFiles({
    name: "SYNTHETIC_FILENAME_MARKER.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("SYNTHETIC_CONTENT_MARKER"),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "File not recognized",
  );
  await expect(validate).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Finalize synthetic import" }),
  ).not.toBeVisible();
  expect(inputs).toHaveLength(1);
  expect(requests.join(" ")).not.toMatch(/SYNTHETIC_(FILENAME|CONTENT)_MARKER/);
  expect(
    await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    ),
  ).not.toMatch(/SYNTHETIC_(FILENAME|CONTENT)_MARKER|Resident A Fixture/);
  await picker.setInputFiles({ ...csv(), name: "practice.xlsx" });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "nonempty practice .csv",
  );
  await page.getByRole("button", { name: "Clear file selection" }).click();
  await expect(page.getByRole("main").getByRole("alert")).not.toBeVisible();
  await picker.setInputFiles(csv());
  await validate.click();
  await expect(
    page.getByRole("checkbox", { name: /I reviewed the households/ }),
  ).not.toBeChecked();
  await page.reload();
  await page
    .getByRole("button", { name: "Import synthetic households" })
    .click();
  await page.getByLabel("Import source", { exact: true }).selectOption("file");
  await expect(page.getByText("No practice file selected.")).toBeVisible();
  await expect(validate).toBeDisabled();
});

test("late file reads cannot replace a newer selection and read errors are sanitized", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    Object.assign(window, { finishSlowRead: () => {} });
    File.prototype.arrayBuffer = function () {
      if (this.name === "slow.csv")
        return new Promise<ArrayBuffer>((resolve) => {
          Object.assign(window, {
            finishSlowRead: () => read.call(this).then(resolve),
          });
        });
      if (this.name === "unreadable.csv")
        return Promise.reject(new Error("SYNTHETIC_PRIVATE_ERROR"));
      return read.call(this);
    };
  });
  const picker = page.getByLabel("Select practice CSV", { exact: true });
  await picker.setInputFiles(csv("tier-three", "slow.csv"));
  await expect(
    page.getByText("Checking practice file on this device…"),
  ).toBeVisible();
  await picker.setInputFiles(csv());
  await expect(
    page.getByText(/Practice file recognized: Valid example/),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { finishSlowRead(): Promise<void> }).finishSlowRead(),
  );
  await expect(
    page.getByText(/Practice file recognized: Valid example/),
  ).toBeVisible();
  await picker.setInputFiles(csv("tier-three", "slow.csv"));
  await expect(
    page.getByText("Checking practice file on this device…"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear file selection" }).click();
  await page.evaluate(() =>
    (window as unknown as { finishSlowRead(): Promise<void> }).finishSlowRead(),
  );
  await expect(page.getByText("No practice file selected.")).toBeVisible();
  await picker.setInputFiles(
    csv("valid-couple-and-buildings", "unreadable.csv"),
  );
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "The practice file could not be read. Select it again.",
  );
  await expect(
    page.getByRole("button", { name: "Validate practice CSV", exact: true }),
  ).toBeDisabled();
});
