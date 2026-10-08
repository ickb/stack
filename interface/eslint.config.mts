// @ts-check

import tseslint from "typescript-eslint";
import rootConfig from "../eslint.config.mts";

export default tseslint.config(
  ...rootConfig,
  {
    ignores: ["eslint.config.mts"],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
);
