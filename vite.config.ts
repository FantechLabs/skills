import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    plugins: ["typescript"],
    categories: {
      correctness: "error",
      suspicious: "error",
    },
    ignorePatterns: ["node_modules/**", "dist/**", "bin/**"],
    options: {
      typeAware: true,
      typeCheck: false,
    },
    rules: {
      // Keep existing boundary assertions and redundant casts out of this tooling migration while
      // enabling the rest of Oxlint's type-aware correctness and suspicious rules.
      "typescript/no-unsafe-type-assertion": "allow",
      "typescript/no-unnecessary-type-assertion": "allow",
      "typescript/no-unnecessary-type-conversion": "allow",
    },
  },
  fmt: {
    ignorePatterns: ["node_modules/**", "dist/**"],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts", "bin/**/*.mjs"],
    },
  },
});
