import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node", // Web Crypto is available on globalThis in Node 20+
  },
});
