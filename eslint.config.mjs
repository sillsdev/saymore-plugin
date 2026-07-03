import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Standalone from the root lameta eslint config (root ignores audio-annotation/).
// Mirrors the root's relaxed rule set so team code style stays consistent.
export default tseslint.config(
  { ignores: ["dist", "test-data/"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty-pattern": "off",
      "no-useless-escape": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "no-case-declarations": "off",
      "@typescript-eslint/no-this-alias": "off",
      "no-empty": "off",
      "no-debugger": "off",
      "prefer-spread": "off"
    }
  }
);
