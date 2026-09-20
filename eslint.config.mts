// @ts-check

import eslint from "@eslint/js";
import type { ESLint, Linter, Rule } from "eslint";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import {
  eslintComments,
  promise,
  reactHooks,
  reactRefresh,
  regexp,
  security,
  sonarjs,
  tsdoc,
  unicorn,
  vitest,
} from "./scripts/tooling/eslint/plugins.ts";

type RuleSeverity = Linter.RuleSeverity;
type RuleEntry = RuleSeverity | [RuleSeverity, ...unknown[]];
interface ConfigObject extends Omit<Linter.Config, "rules"> {
  rules?: Record<string, RuleEntry>;
}
type ConfigInput = ConfigObject | ConfigInput[];
interface PluginWithConfigs {
  configs: Record<string, ConfigInput>;
}

function pluginConfig(plugin: PluginWithConfigs, name: string): ConfigInput {
  const config = plugin.configs[name];
  if (config === undefined) {
    throw new Error(`Missing ESLint plugin config ${name}`);
  }
  return config;
}

const guardedVitestRuleErrors = {
  "vitest/max-nested-describe": "error",
  "vitest/no-interpolation-in-snapshots": "error",
  "vitest/no-large-snapshots": "error",
  "vitest/no-conditional-expect": "error",
  "vitest/no-conditional-tests": "error",
  "vitest/no-commented-out-tests": "error",
  "vitest/no-disabled-tests": "error",
  "vitest/no-duplicate-hooks": "error",
  "vitest/expect-expect": "error",
  "vitest/no-focused-tests": "error",
  "vitest/no-identical-title": "error",
  "vitest/no-import-node-test": "error",
  "vitest/no-mocks-import": "error",
  "vitest/no-restricted-matchers": "error",
  "vitest/no-standalone-expect": "error",
  "vitest/no-test-return-statement": "error",
  "vitest/hoisted-apis-on-top": "error",
  "vitest/no-unneeded-async-expect-function": "error",
  "vitest/prefer-called-with": "error",
  "vitest/prefer-comparison-matcher": "error",
  "vitest/prefer-each": "error",
  "vitest/prefer-equality-matcher": "error",
  "vitest/prefer-expect-resolves": "error",
  "vitest/prefer-import-in-mock": "error",
  "vitest/prefer-strict-boolean-matchers": "error",
  "vitest/prefer-snapshot-hint": "error",
  "vitest/prefer-hooks-in-order": "error",
  "vitest/prefer-hooks-on-top": "error",
  "vitest/require-awaited-expect-poll": "error",
  "vitest/require-local-test-context-for-concurrent-snapshots": "error",
  "vitest/require-to-throw-message": "error",
  "vitest/valid-describe-callback": "error",
  "vitest/valid-expect": "error",
  "vitest/valid-expect-in-promise": "error",
  "vitest/warn-todo": "error",
} as const;

// CKB invariants (decisions amendment 36): each selector encodes a fund-safety or
// chain-correctness rule, not a style proxy.
const restrictedSyntax = [
  {
    selector:
      "BinaryExpression[operator=/^[!=]==?$/u]:matches([left.type='MemberExpression'][left.property.name=/^(?:args|codeHash|hashType)$/u], [right.type='MemberExpression'][right.property.name=/^(?:args|codeHash|hashType)$/u], [left.type='MemberExpression'][left.property.value=/^(?:args|codeHash|hashType)$/u], [right.type='MemberExpression'][right.property.value=/^(?:args|codeHash|hashType)$/u])",
    message:
      "Do not compare script identity field by field. Compare whole scripts with Script.eq or by hash.",
  },
  {
    selector:
      "TSAsExpression:not([typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name='const']), TSTypeAssertion",
    message:
      "Avoid type assertions. If this cast is justified, add a local ESLint disable with the reason.",
  },
];

// Production-only bans: each pattern below is a shape that exists to satisfy a lint metric or a test double, not a consumer.
const productionRestrictedSyntax = [
  {
    selector:
      "TSTypeReference[typeName.name='Record'][typeArguments.params.0.type='TSStringKeyword'][typeArguments.params.1.type='TSUnknownKeyword']",
    message:
      "Parse untyped input into a declared type at the boundary instead of passing Record<string, unknown> through production code.",
  },
  {
    selector:
      "TSInterfaceDeclaration[id.name=/Dependenc(?:y|ies)$/u], TSTypeAliasDeclaration[id.name=/Dependenc(?:y|ies)$/u]",
    message:
      "An injectable dependency bag exists only to be mocked. Call the real API and test against real resources.",
  },
  {
    selector: "TSPropertySignature[optional=true] > TSTypeAnnotation > TSTypeQuery",
    message:
      "An optional `typeof realFunction` slot is a mock seam. Call the real function directly.",
  },
  {
    selector:
      "AssignmentPattern[left.typeAnnotation.typeAnnotation.type='TSFunctionType'], AssignmentPattern[right.type='MemberExpression'][right.object.name='process'], AssignmentPattern[right.type='CallExpression'][right.callee.object.object.name='process']",
    message:
      "A parameter defaulting to a real implementation or a process global is a mock seam. Read the real value where it is used.",
  },
  // Cell reads go through the SDK's one uncached paging loop (decisions amendment 52):
  // CCC's cached iterators are never used for financial state.
  {
    selector:
      "CallExpression[callee.property.name='findCellsOnChain'], CallExpression[callee.property.name='findCells']:not([callee.object.property.name='cache'])",
    message:
      "Read cells through the SDK's findCells helper, never CCC's cached iterators.",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^findCellsPaged(?:NoCache)?$/u]:not(FunctionDeclaration[id.name='findCells'] CallExpression[callee.property.name=/^findCellsPaged(?:NoCache)?$/u])",
    message: "Page through the client only inside the SDK's findCells helper.",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^findCellsPaged(?:NoCache)?$/u][arguments.length<4]",
    message: "Pass the page size and the cursor to every paged cell scan.",
  },
];

// rollup deletes a `/* @__PURE__ */` call inside a class static block while keeping the
// class, which silently breaks entities at runtime (decisions amendment 12). Comments are
// not AST nodes, so a selector cannot express this; the rule reads the block's comments.
const noPureInStaticBlock: Rule.RuleModule = {
  meta: {
    type: "problem",
    schema: [],
    messages: { pure: "Do not use a @__PURE__ annotation inside a class static block." },
  },
  create(context): Rule.RuleListener {
    return {
      StaticBlock(node: Rule.Node): void {
        for (const comment of context.sourceCode.getCommentsInside(node)) {
          if (comment.value.includes("@__PURE__")) {
            context.report({ messageId: "pure", node: comment });
          }
        }
      },
    };
  },
};

const localPlugin: ESLint.Plugin = {
  rules: { "no-pure-in-static-block": noPureInStaticBlock },
};

export default defineConfig(
  { ignores: ["**/dist/**"] },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  eslint.configs.recommended,
  sonarjs.configs.recommended,
  unicorn.configs.unopinionated,
  regexp.configs["flat/recommended"],
  pluginConfig(security, "recommended"),
  pluginConfig(promise, "flat/recommended"),
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    files: ["**/*.{ts,tsx,mts}"],
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
      local: localPlugin,
      tsdoc,
    },
    rules: {
      "array-callback-return": "error",
      curly: "error",
      eqeqeq: "error",
      "no-duplicate-imports": "error",
      "no-else-return": "error",
      "no-console": ["error", { allow: ["error"] }],
      "no-lonely-if": "error",
      "no-shadow": "off",
      "no-use-before-define": "off",
      "no-param-reassign": ["error", { props: true }],
      "no-promise-executor-return": "error",
      "object-shorthand": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@ickb/*/src/*", "../*/src/*", "../../*/src/*"],
              message:
                "Import through package public exports instead of another package's src tree.",
            },
          ],
        },
      ],
      "no-self-compare": "error",
      "no-template-curly-in-string": "error",
      "no-unmodified-loop-condition": "error",
      "no-useless-return": "error",
      "prefer-template": "error",
      "no-restricted-syntax": ["error", ...restrictedSyntax],
      "local/no-pure-in-static-block": "error",
      "security/detect-object-injection": "off",
      "sonarjs/destructuring-assignment-syntax": "error",
      "sonarjs/nested-control-flow": "error",
      "sonarjs/prefer-immediate-return": "error",
      "tsdoc/syntax": "error",
      "promise/no-multiple-resolved": "error",
      "regexp/no-super-linear-move": "error",
      "@eslint-community/eslint-comments/no-restricted-disable": [
        "error",
        "@eslint-community/eslint-comments/no-restricted-disable",
        "@eslint-community/eslint-comments/no-unlimited-disable",
        "@eslint-community/eslint-comments/no-use",
        "@eslint-community/eslint-comments/require-description",
        "sonarjs/comment-regex",
        ...Object.keys(guardedVitestRuleErrors),
      ],
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/no-use": [
        "error",
        { allow: ["eslint-disable-next-line"] },
      ],
      "@eslint-community/eslint-comments/require-description": "error",
      "unicorn/no-duplicate-if-branches": "error",
      "unicorn/no-duplicate-set-values": "error",
      "unicorn/no-mismatched-map-key": "error",
      "unicorn/no-return-array-push": "error",
      "unicorn/custom-error-definition": "error",
      "unicorn/no-negated-condition": "off",
      "unicorn/no-unreadable-array-destructuring": "off",
      "unicorn/number-literal-case": "off",
      "unicorn/numeric-separators-style": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
      "@typescript-eslint/consistent-return": "error",
      "@typescript-eslint/default-param-last": "error",
      "@typescript-eslint/explicit-member-accessibility": [
        "error",
        {
          accessibility: "explicit",
          overrides: { constructors: "no-public" },
        },
      ],
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/method-signature-style": "error",
      "@typescript-eslint/no-dupe-class-members": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-loop-func": "error",
      "@typescript-eslint/no-redeclare": ["error", { ignoreDeclarationMerge: true }],
      "@typescript-eslint/no-shadow": ["error", { hoist: "never" }],
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/no-unnecessary-parameter-property-assignment": "error",
      "@typescript-eslint/no-unnecessary-qualifier": "error",
      "@typescript-eslint/no-use-before-define": [
        "error",
        {
          classes: false,
          enums: false,
          functions: false,
          ignoreTypeReferences: true,
          typedefs: false,
          variables: true,
        },
      ],
      "@typescript-eslint/no-useless-empty-export": "error",
      "@typescript-eslint/prefer-enum-initializers": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/require-array-sort-compare": "error",
      "@typescript-eslint/promise-function-async": ["error", { allowAny: false }],
      "@typescript-eslint/return-await": ["error", "in-try-catch"],
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowAny: false,
          allowNullableBoolean: false,
          allowNullableEnum: false,
          allowNullableNumber: false,
          allowNullableObject: false,
          allowNullableString: false,
          allowNumber: false,
          allowString: false,
        },
      ],
      "@typescript-eslint/strict-void-return": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["{sdk,sdk/node,interface}/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...productionRestrictedSyntax,
      ],
    },
  },
  {
    // Where the 100% coverage thresholds apply, nothing may opt a branch out of them.
    files: ["sdk/**/*.ts"],
    rules: {
      "sonarjs/comment-regex": [
        "error",
        {
          regularExpression: String.raw`\b(?:istanbul|c8|v8|coverage)[\s_-]*i[\s_-]*g[\s_-]*n[\s_-]*o[\s_-]*r[\s_-]*e\b`,
          flags: "iu",
          message: "Coverage ignore comments are not allowed.",
        },
      ],
    },
  },
  {
    files: [
      "sdk/src/order/info.ts",
      "sdk/src/order/order_data.ts",
      "sdk/src/order/ratio.ts",
      "sdk/src/order/relative.ts",
      "sdk/src/sdk.ts",
    ],
    rules: {
      "@typescript-eslint/method-signature-style": "off",
    },
  },
  {
    files: ["scripts/**/*.ts", "sdk/node/**/*.ts"],
    rules: {
      // The actors beside the SDK drive its full class by relative import; the package
      // barrel stays the one public entry (decisions amendment 52).
      "no-restricted-imports": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "interface/src/**/*.ts",
      "interface/src/**/*.tsx",
      "interface/test/**/*.ts",
      "interface/test/**/*.tsx",
      "src/**/*.ts",
      "src/**/*.tsx",
      "test/**/*.ts",
      "test/**/*.tsx",
    ],
    plugins: {
      ...reactHooks.configs.flat["recommended-latest"].plugins,
      ...reactRefresh.configs.recommended.plugins,
    },
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      ...reactRefresh.configs.recommended.rules,
    },
  },
  {
    files: ["scripts/**/*.ts", "{sdk,sdk/node,testkit,interface}/test/**/*.{ts,tsx}"],
    rules: {
      // This rule flags only paths constructed by the repository in scripts and tests.
      "security/detect-non-literal-fs-filename": "off",
    },
  },
  {
    files: ["{sdk,sdk/node,testkit,interface}/test/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"],
    plugins: {
      vitest,
    },
    rules: {
      "no-restricted-imports": "off",
      ...guardedVitestRuleErrors,
      "vitest/max-nested-describe": ["error", { max: 3 }],
      "vitest/no-restricted-matchers": [
        "error",
        {
          toBeDefined:
            "Avoid toBeDefined. Assert a concrete value, or use a throwing guard before concrete assertions.",
          "resolves.toBeDefined":
            "Avoid resolves.toBeDefined. Await the call and assert concrete behavior.",
        },
      ],
      "vitest/prefer-snapshot-hint": ["error", "always"],
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: [
            "expect",
            "expectDefaultPageSizeScan",
            "expectRealBaseTransactionEffects",
            "expectSharedPageSizeForCapacityAndWithdrawalScans",
            "expectCustomPageSizeThroughL1StateLoading",
          ],
        },
      ],
    },
  },
  {
    // The oracle's independence from the SDK is a dependency-cruiser rule (amendment 44).
    files: ["testkit/src/contract_oracle.ts"],
    linterOptions: { noInlineConfig: true },
    rules: {
      // The oracle mirrors deployed Rust control flow; restructuring it for this metric harms auditability.
      "sonarjs/cognitive-complexity": "off",
    },
  },
);
