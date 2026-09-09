import { test, expect } from "@playwright/test";

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
  await expect(
    page.getByRole("button", { name: "Load synthetic campaigns" }),
  ).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("email-code UI handles invalid code, signed-in campaigns and sign-out (mock transport, not provider proof)", async ({
  page,
}) => {
  let signedIn = false;
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
    if (path.endsWith("/send-code"))
      return json({
        message: "If this is an approved account, a code will arrive by email.",
      });
    if (path.endsWith("/verify-code")) {
      if (route.request().postDataJSON().code !== "123456")
        return json({ error: "The sign-in code is invalid or expired." }, 401);
      signedIn = true;
      return json({
        administrator: { id: "synthetic", email: "organizer@example.test" },
      });
    }
    if (path.endsWith("/campaigns")) return json({ campaigns: [] });
    return route.abort();
  });
  await page.goto("/admin");
  await page.getByLabel("Administrator email").fill("organizer@example.test");
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await page.getByLabel("Six-digit sign-in code").fill("000000");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "invalid or expired",
  );
  await page.getByLabel("Six-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByRole("heading", { name: "Signed in", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load synthetic campaigns" }).click();
  await expect(page.getByText(/No active synthetic campaigns/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Signed in", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Administrator email")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Signed-in administrator" }),
  ).not.toBeVisible();
  await page.screenshot({
    path: `test-results/admin-${test.info().project.name}.png`,
    fullPage: true,
  });
});
