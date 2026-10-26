import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgresql://sourcemark:sourcemark@localhost:5434/sourcemark_test",
    },
    globalSetup: "./test/globalSetup.ts",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
