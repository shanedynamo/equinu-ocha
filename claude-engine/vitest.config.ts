import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      ANTHROPIC_API_KEY: "test-key-not-real",
      NODE_ENV: "test",
    },
  },
});
