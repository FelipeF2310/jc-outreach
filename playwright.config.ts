import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "off", screenshot: "off" },
  projects: [
    {
      name: "chromium-phone",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "webkit-phone",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
  webServer: {
    env: { JCO_EPHEMERAL_DEMO: "1" },
    command: "npm run demo -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
