import { defineConfig } from "@playwright/test";

const devPort = Number(process.env.DRONELAB_TEST_DEV_PORT ?? 5181);
const previewPort = Number(process.env.DRONELAB_TEST_PREVIEW_PORT ?? 5182);

export default defineConfig({
  testDir: "./tests",
  testMatch: ["integrations.spec.ts", "workers.spec.ts", "storage.spec.ts", "app.spec.ts", "fpv.spec.ts", "arcade.spec.ts"],
  workers: 1,
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${devPort}`, trace: "retain-on-failure" },
  webServer: [
    {
      command: `npm run dev -- --port ${devPort}`,
      url: `http://127.0.0.1:${devPort}/tests/worker-harness.html`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run preview -- --port ${previewPort}`,
      url: `http://127.0.0.1:${previewPort}`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
