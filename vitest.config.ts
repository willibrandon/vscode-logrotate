import { defineConfig, type ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: [
      "node_modules/**",
      "dist/**",
      "test/integration/**",
      "test/performance/**",
      "test/web/**",
    ],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    restoreMocks: true,
  },
});

export default config;
