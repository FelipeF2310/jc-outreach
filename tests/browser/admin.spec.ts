import { test, expect } from "@playwright/test";
import { rehearsalCsv } from "../../src/server/import-rehearsal";
import { validateImport } from "../../src/server/import-validation";

test("saved campaign imports synthetic households, rejects bad examples and restores its receipt (mock transport)", async ({
  page,
}) => {
  const campaignId = "00000000-0000-4000-8000-000000000099";
  let receipt: {
    importId: string;
    campaignId: string;
    counts: { people: number; households: number; buildings: number };
    finalizedAt: string;
  } | null = null;
  let commits = 0,
    attempts = 0;
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          administrator: { id: "synthetic", email: "organizer@example.test" },
        },
      });
    if (path.endsWith("/campaigns"))
      return route.fulfill({
        json: {
          campaigns: [
            {
              id: campaignId,
              name: "Synthetic: Saved practice",
              endAt: "2030-05-02T03:59:59Z",
              deletionAt: "2030-06-01T03:59:59Z",
              importReady: true,
              importReceipt: receipt,
            },
          ],
        },
      });
    const input = route.request().postDataJSON();
    expect(input.campaignId).toBe(campaignId);
    const { preview } = validateImport(rehearsalCsv(input.caseId));
    if (input.action === "preview") return route.fulfill({ json: { preview } });
    expect(input.confirmed).toBe(true);
    expect(input.digest).toBe(preview.digest);
    if (!receipt) {
      commits++;
      receipt = {
        importId: "00000000-0000-4000-8000-000000000098",
        campaignId,
        counts: { people: 4, households: 3, buildings: 2 },
        finalizedAt: "2030-01-01T00:00:00Z",
      };
    }
    attempts++;
    if (attempts === 1) return route.abort("failed");
    return route.fulfill({ json: { receipt } });
  });
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Import synthetic households" })
    .click();
  expect(await page.locator('input[type="file"]').count()).toBe(0);
  await page.getByLabel("Synthetic CSV example").selectOption("tier-three");
  await page.getByRole("button", { name: "Validate example" }).click();
  await expect(
    page.getByText("Import rejected — no records stored"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finalize synthetic import" }),
  ).not.toBeVisible();
  expect(commits).toBe(0);
  await page
    .getByLabel("Synthetic CSV example")
    .selectOption("valid-couple-and-buildings");
  await page.getByRole("button", { name: "Validate example" }).click();
  await expect(page.getByText("ONE DOOR", { exact: true })).toHaveCount(3);
  await expect(
    page.getByText("Resident A Fixture · Resident B Fixture", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finalize synthetic import" }),
  ).toBeDisabled();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.screenshot({
    path: `test-results/hosted-import-preview-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("checkbox", { name: /I reviewed the households/ })
    .check();
  await page.getByRole("button", { name: "Finalize synthetic import" }).click();
  await expect(
    page.getByRole("button", { name: "Retry import" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Synthetic CSV example")).toBeDisabled();
  await page.getByRole("button", { name: "Retry import" }).click();
  await expect(
    page.getByText("4 people · 3 households · 2 buildings saved."),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Import finalized" }),
  ).toBeVisible();
  await expect(
    page.getByText("4 people · 3 households · 2 buildings saved."),
  ).toBeVisible();
  expect(commits).toBe(1);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `test-results/hosted-import-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("administrator shell fails closed without configuration and is separate from volunteer links", async ({
  page,
  request,
}) => {
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Administrator access" }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Administrator sign-in is not configured",
  );
  await expect(
    page.getByText(/Volunteers still use their private assignment links/),
  ).toBeVisible();
  for (const path of ["session", "campaigns"]) {
    const response = await request.get(`/api/admin/${path}`, {
      headers: { "X-JCO-Demo": "1", "X-JCO-Admin": "1" },
    });
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  for (const path of ["send-code", "verify-code"]) {
    expect(
      (await request.post(`/api/admin/${path}`, { data: {} })).status(),
    ).toBe(404);
  }
  await expect(
    page.getByRole("button", { name: "Refresh campaigns" }),
  ).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("campaign form preserves a pending save across reload and renders confirmed dates (mock transport)", async ({
  page,
}) => {
  let received: { id: string; name: string; endDate: string } | undefined;
  let writes = 0;
  const campaign = () => ({
    id: received!.id,
    name: `Synthetic: ${received!.name}`,
    endAt: "2030-02-21T04:59:59.000Z",
    deletionAt: "2030-03-23T03:59:59.000Z",
  });
  await page.route("**/api/admin/**", async (route) => {
    if (route.request().url().endsWith("/session"))
      return route.fulfill({
        json: {
          administrator: {
            id: "synthetic-campaign-admin",
            email: "organizer@example.test",
          },
        },
      });
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { campaigns: received ? [campaign()] : [] },
      });
    const payload = route.request().postDataJSON();
    if (!received) {
      received = payload;
      writes++;
      return route.abort("failed");
    }
    expect(payload).toEqual(received);
    return route.fulfill({ json: { campaign: campaign() } });
  });
  await page.goto("/admin");
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("Ward A practice");
  await page
    .getByLabel("Campaign end date", { exact: true })
    .fill("2030-02-20");
  await page
    .getByRole("button", { name: "Create campaign", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry campaign save" }),
  ).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(
    "Ward A practice",
  );
  await expect(
    page.getByLabel("Campaign name", { exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Retry campaign save" }).click();
  await expect(
    page.getByText("Campaign saved. No households have been imported."),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic: Ward A practice", { exact: true }),
  ).toBeVisible();
  const signOut = await page
    .getByRole("button", { name: "Sign out", exact: true })
    .boundingBox();
  const createHeading = await page
    .getByRole("heading", { name: "Create synthetic campaign", exact: true })
    .boundingBox();
  expect(
    createHeading!.y - (signOut!.y + signOut!.height),
  ).toBeGreaterThanOrEqual(24);
  await expect(page.getByText(/Campaign ends:.*2\/20\/2030/)).toBeVisible();
  await expect(
    page.getByText(/Deletion scheduled:.*3\/22\/2030/),
  ).toBeVisible();
  expect(writes).toBe(1);
  await page.reload();
  await expect(
    page.getByText("Synthetic: Ward A practice", { exact: true }),
  ).toBeVisible();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `test-results/campaign-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("password UI handles invalid credentials, signed-in campaigns and sign-out (mock transport, not provider proof)", async ({
  page,
}) => {
  let signedIn = false;
  let databaseReady = false;
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body });
    if (path.endsWith("/session") && route.request().method() === "DELETE") {
      signedIn = false;
      return json({ signedOut: true });
    }
    if (path.endsWith("/session"))
      return signedIn
        ? json({
            administrator: { id: "synthetic", email: "organizer@example.test" },
          })
        : json({ error: "Sign in as an approved administrator." }, 401);
    if (path.endsWith("/sign-in")) {
      expect(route.request().postDataJSON().email).toBe(
        "organizer@example.test",
      );
      if (route.request().postDataJSON().password !== "synthetic-password")
        return json(
          {
            error:
              "Unable to sign in. Check your email and password or contact the website owner.",
          },
          401,
        );
      signedIn = true;
      return json({
        administrator: { id: "synthetic", email: "organizer@example.test" },
      });
    }
    if (path.endsWith("/campaigns"))
      return databaseReady
        ? json({ campaigns: [] })
        : json(
            {
              error:
                "Database setup is incomplete. Your administrator sign-in is working, but campaigns are not connected yet.",
            },
            503,
          );
    return route.abort();
  });
  await page.goto("/admin");
  await page.getByLabel("Administrator email").fill("organizer@example.test");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Unable to sign in",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Signed in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Database setup is incomplete",
  );
  await expect(
    page.getByRole("heading", { name: "Signed in", exact: true }),
  ).toBeVisible();
  databaseReady = true;
  await page.getByRole("button", { name: "Retry loading campaigns" }).click();
  await expect(page.getByText(/No active synthetic campaigns/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Signed in", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/No active synthetic campaigns/)).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Administrator email")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain("synthetic-password");
  await expect(
    page.getByRole("region", { name: "Signed-in administrator" }),
  ).not.toBeVisible();
  await page.screenshot({
    path: `test-results/admin-${test.info().project.name}.png`,
    fullPage: true,
  });
});
