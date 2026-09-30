import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["workers.spec.ts", "storage.spec.ts", "app.spec.ts", "fpv.spec.ts", "arcade.spec.ts"],
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:5181", trace: "retain-on-failure" },
  webServer: [
    {
      command: "npm run dev -- --port 5181",
      url: "http://127.0.0.1:5181/tests/worker-harness.html",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run preview -- --port 5182",
      url: "http://127.0.0.1:5182",
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
