import { defineConfig, type ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = defineConfig({
  test: {
    environment: "node",
    include: ["test/performance/**/*.bench.ts"],
    testTimeout: 30_000,
    restoreMocks: true,
    fileParallelism: false,
    maxWorkers: 1,
  },
});

export default config;
