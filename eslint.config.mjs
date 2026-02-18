// @ts-check

import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["**/dist/**"],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    rules: {
      "array-callback-return": "error",
      eqeqeq: "error",
      "no-self-compare": "error",
      "no-constant-binary-expression": "error",
      "no-template-curly-in-string": "error",
      "no-constructor-return": "error",
      "no-promise-executor-return": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='Error']",
          message: "Use `new Error(...)` instead of `Error(...)`.",
        },
      ],
      "@typescript-eslint/explicit-function-return-type": "error",
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
