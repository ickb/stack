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

const classMemberOrder = {
  memberTypes: [
    "signature",
    ["public-static-field", "protected-static-field", "private-static-field"],
    "static-field",
    "static-initialization",
    ["public-instance-field", "protected-instance-field", "private-instance-field"],
    "instance-field",
    "field",
    "constructor",
    [
      "public-static-accessor",
      "public-static-get",
      "public-static-set",
      "public-instance-accessor",
      "public-instance-get",
      "public-instance-set",
      "public-accessor",
      "public-get",
      "public-set",
    ],
    ["public-static-method", "public-instance-method", "public-method"],
    [
      "protected-static-accessor",
      "protected-static-get",
      "protected-static-set",
      "protected-instance-accessor",
      "protected-instance-get",
      "protected-instance-set",
      "protected-accessor",
      "protected-get",
      "protected-set",
    ],
    ["protected-static-method", "protected-instance-method", "protected-method"],
    [
      "private-static-accessor",
      "private-static-get",
      "private-static-set",
      "#private-static-accessor",
      "#private-static-get",
      "#private-static-set",
      "private-instance-accessor",
      "private-instance-get",
      "private-instance-set",
      "#private-instance-accessor",
      "#private-instance-get",
      "#private-instance-set",
      "private-accessor",
      "private-get",
      "private-set",
      "#private-accessor",
      "#private-get",
      "#private-set",
    ],
    [
      "private-static-method",
      "private-instance-method",
      "private-method",
      "#private-static-method",
      "#private-instance-method",
      "#private-method",
    ],
    "method",
  ],
};

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

const restrictedSyntax = [
  {
    selector: ":function > RestElement > ArrayPattern",
    message:
      "Do not hide a long parameter list behind a rest tuple. Pass one named options object.",
  },
  {
    selector: "CallExpression[callee.name='Error']",
    message: "Use `new Error(...)` instead of `Error(...)`.",
  },
  {
    selector:
      "TSAsExpression:not([typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name='const']), TSTypeAssertion",
    message:
      "Avoid type assertions. If this cast is justified, add a local ESLint disable with the reason.",
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name='todo']",
    message: "Do not add placeholder tests. Delete the file or add a real assertion.",
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name=/^(?:assertions|hasAssertions)$/u]",
    message:
      "Do not use assertion-count placeholders. Add a concrete behavior assertion or an explicit assertion helper instead.",
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='anything'][arguments.length=0]",
    message: "Do not use expect.anything(). Assert a concrete value or behavior instead.",
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='any'][arguments.0.type='Identifier'][arguments.0.name=/^(?:Function|Object)$/u]",
    message:
      "Do not use expect.any(Object) or expect.any(Function). Assert a concrete value, shape, or behavior instead.",
  },
  {
    selector:
      "MethodDefinition[accessibility=private] > FunctionExpression > Identifier.params:has(TSTypeReference[typeName.type='TSQualifiedName'][typeName.left.name='ccc'][typeName.right.name=/Like$/]), MethodDefinition[key.type='PrivateIdentifier'] > FunctionExpression > Identifier.params:has(TSTypeReference[typeName.type='TSQualifiedName'][typeName.left.name='ccc'][typeName.right.name=/Like$/])",
    message:
      "Private protocol helpers should receive normalized CCC values, not broad CCC *Like inputs.",
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name='toMatchObject'][arguments.0.type='ObjectExpression'][arguments.0.properties.length=0]",
    message:
      "Do not use toMatchObject({}). Assert a concrete property, exact empty object, or explicit behavior instead.",
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='objectContaining'][arguments.0.type='ObjectExpression'][arguments.0.properties.length=0], CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='objectContaining'][arguments.0.type=/^(?:TSAsExpression|TSSatisfiesExpression)$/u][arguments.0.expression.type='ObjectExpression'][arguments.0.expression.properties.length=0], CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='objectContaining'][arguments.0.type=/^(?:TSAsExpression|TSSatisfiesExpression)$/u][arguments.0.expression.type=/^(?:TSAsExpression|TSSatisfiesExpression)$/u][arguments.0.expression.expression.type='ObjectExpression'][arguments.0.expression.expression.properties.length=0]",
    message:
      "Do not use expect.objectContaining({}). Assert a concrete property, exact empty object, or explicit behavior instead.",
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='arrayContaining'][arguments.0.type='ArrayExpression'][arguments.0.elements.length=0], CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='arrayContaining'][arguments.0.type=/^(?:TSAsExpression|TSSatisfiesExpression)$/u][arguments.0.expression.type='ArrayExpression'][arguments.0.expression.elements.length=0], CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='arrayContaining'][arguments.0.type=/^(?:TSAsExpression|TSSatisfiesExpression)$/u][arguments.0.expression.type=/^(?:TSAsExpression|TSSatisfiesExpression)$/u][arguments.0.expression.expression.type='ArrayExpression'][arguments.0.expression.expression.elements.length=0]",
    message:
      "Do not use expect.arrayContaining([]). Assert exact emptiness or concrete elements instead.",
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='stringContaining'][arguments.0.type='Literal'][arguments.0.value=''], CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='stringContaining'][arguments.0.type=/^(?:TSAsExpression|TSSatisfiesExpression)$/u][arguments.0.expression.type='Literal'][arguments.0.expression.value=''], CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='stringContaining'][arguments.0.type=/^(?:TSAsExpression|TSSatisfiesExpression)$/u][arguments.0.expression.type=/^(?:TSAsExpression|TSSatisfiesExpression)$/u][arguments.0.expression.expression.type='Literal'][arguments.0.expression.expression.value=''], CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='stringContaining'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.0.value.raw=''], CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='stringContaining'][arguments.0.type=/^(?:TSAsExpression|TSSatisfiesExpression)$/u][arguments.0.expression.type='TemplateLiteral'][arguments.0.expression.expressions.length=0][arguments.0.expression.quasis.0.value.raw=''], CallExpression[callee.type='MemberExpression'][callee.object.name='expect'][callee.property.name='stringContaining'][arguments.0.type=/^(?:TSAsExpression|TSSatisfiesExpression)$/u][arguments.0.expression.type=/^(?:TSAsExpression|TSSatisfiesExpression)$/u][arguments.0.expression.expression.type='TemplateLiteral'][arguments.0.expression.expression.expressions.length=0][arguments.0.expression.expression.quasis.0.value.raw='']",
    message:
      'Do not use expect.stringContaining(""). Assert exact emptiness or concrete text instead.',
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name='toHaveLength'][callee.object.type='MemberExpression'][callee.object.property.name='not'][callee.object.object.type='CallExpression'][callee.object.object.callee.name='expect'][callee.object.object.arguments.0.type='CallExpression'][callee.object.object.arguments.0.callee.type='MemberExpression'][callee.object.object.arguments.0.callee.property.name='filter'][arguments.0.value=0]",
    message:
      "Avoid filter(...).not.toHaveLength(0). Assert the matched item or explicit filtered collection so failures show the missing behavior.",
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name='toHaveLength'][callee.object.type='CallExpression'][callee.object.callee.name='expect'][callee.object.arguments.0.type='CallExpression'][callee.object.arguments.0.callee.type='MemberExpression'][callee.object.arguments.0.callee.property.name='filter'][arguments.0.type='MemberExpression'][arguments.0.property.name='length']",
    message:
      "Avoid filter(...).toHaveLength(items.length). Assert the mapped values or explicit filtered collection so failures show the mismatched behavior.",
  },
  {
    selector:
      "CallExpression:matches([arguments.0.value=true], [arguments.0.value=false])[callee.type='MemberExpression'][callee.computed=false][callee.object.type='CallExpression'][callee.object.callee.name='expect'][callee.object.arguments.0.type='CallExpression'][callee.object.arguments.0.callee.type='MemberExpression'][callee.object.arguments.0.callee.computed=false][callee.object.arguments.0.callee.property.name=/^(?:every|some)$/u]",
    message:
      "Avoid asserting every(...) or some(...) as a bare boolean. Assert the matched item, filtered collection, or explicit length so failures show the missing behavior.",
  },
  {
    selector:
      "CallExpression:matches([arguments.1.value=true], [arguments.1.value=false])[callee.type='MemberExpression'][callee.object.name='assert']:matches([callee.computed=false][callee.property.name='equal'], [callee.computed=true][callee.property.value='equal'])[arguments.0.type='CallExpression'][arguments.0.callee.type='MemberExpression'][arguments.0.callee.computed=false][arguments.0.callee.property.name=/^(?:every|some)$/u]",
    message:
      "Avoid asserting every(...) or some(...) as a bare boolean. Assert the matched item, filtered collection, or explicit length so failures show the missing behavior.",
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(?:fails|retry)$/u]",
    message: "Do not commit retried or expected-failing tests.",
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
];

const noDependencyLoading: Rule.RuleModule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      dynamic: "The contract oracle must not load dependencies dynamically.",
      reference: "The contract oracle must not reference dependency declarations.",
      type: "The contract oracle must not reference dependencies through import types.",
    },
  },
  create(context): Rule.RuleListener {
    const loaderNames = new Set(["createRequire", "getBuiltinModule", "require"]);

    return {
      Identifier(node: Rule.Node): void {
        if (loaderNames.has(context.sourceCode.getText(node))) {
          context.report({ messageId: "dynamic", node });
        }
      },
      ImportExpression(node: Rule.Node): void {
        context.report({ messageId: "dynamic", node });
      },
      Program(): void {
        for (const comment of context.sourceCode.getAllComments()) {
          if (/^\/\s*<reference\b/iu.test(comment.value.trim())) {
            context.report({ messageId: "reference", node: comment });
          }
        }
      },
      TSImportType(node: Rule.Node): void {
        context.report({ messageId: "type", node });
      },
    };
  },
};

const oracleIndependencePlugin: ESLint.Plugin = {
  rules: {
    "no-dependency-loading": noDependencyLoading,
  },
};

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
      complexity: ["error", { max: 15 }],
      "array-callback-return": "error",
      curly: "error",
      eqeqeq: "error",
      "no-duplicate-imports": "error",
      "no-else-return": "error",
      "no-console": ["error", { allow: ["error"] }],
      "max-params": ["error", { max: 4, countThis: "except-void" }],
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
      "no-warning-comments": [
        "error",
        {
          location: "anywhere",
          terms: ["todo", "fixme", "hack", "xxx"],
        },
      ],
      "prefer-template": "error",
      "no-restricted-syntax": ["error", ...restrictedSyntax],
      "local/no-pure-in-static-block": "error",
      "security/detect-object-injection": "off",
      "sonarjs/comment-regex": [
        "error",
        {
          regularExpression: String.raw`\b(?:istanbul|c8|v8|coverage)[\s_-]*i[\s_-]*g[\s_-]*n[\s_-]*o[\s_-]*r[\s_-]*e\b`,
          flags: "iu",
          message: "Coverage ignore comments are not allowed.",
        },
      ],
      "sonarjs/destructuring-assignment-syntax": "error",
      "sonarjs/max-lines-per-function": ["error", { maximum: 80 }],
      "sonarjs/nested-control-flow": "error",
      "sonarjs/no-duplicate-string": ["error", { threshold: 3 }],
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
        "no-warning-comments",
        "sonarjs/comment-regex",
        "sonarjs/fixme-tag",
        "sonarjs/todo-tag",
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
      "@typescript-eslint/member-ordering": [
        "error",
        {
          classExpressions: classMemberOrder,
          classes: classMemberOrder,
          default: "never",
        },
      ],
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
    files: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
    ignores: ["packages/testkit/src/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...productionRestrictedSyntax,
      ],
    },
  },
  {
    files: ["packages/sdk/src/order/io/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-types": [
        "error",
        {
          types: {
            "ccc.TransactionLike":
              "Normalize at the public OrderManager boundary and pass ccc.Transaction to internal transaction helpers.",
            InfoLike:
              "Normalize at the public OrderManager boundary and pass Info to internal order IO helpers.",
          },
        },
      ],
    },
  },
  {
    files: [
      "packages/sdk/src/core/entities.ts",
      "packages/sdk/src/order/model/info.ts",
      "packages/sdk/src/order/model/order_data.ts",
      "packages/sdk/src/order/model/ratio.ts",
      "packages/sdk/src/order/model/relative.ts",
      "packages/sdk/src/sdk.ts",
    ],
    rules: {
      "@typescript-eslint/method-signature-style": "off",
    },
  },
  {
    files: [
      "scripts/**/*.ts",
      "packages/bot/**/*.ts",
      "packages/node-utils/**/*.ts",
      "packages/validation/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "apps/interface/src/**/*.ts",
      "apps/interface/src/**/*.tsx",
      "apps/interface/test/**/*.ts",
      "apps/interface/test/**/*.tsx",
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
    files: [
      "scripts/**/*.ts",
      "apps/*/test/**/*.{ts,tsx}",
      "packages/*/test/**/*.{ts,tsx}",
    ],
    rules: {
      // This rule flags only paths constructed by the repository in scripts and tests.
      "security/detect-non-literal-fs-filename": "off",
    },
  },
  {
    files: [
      "apps/*/test/**/*.{ts,tsx}",
      "packages/*/test/**/*.{ts,tsx}",
      "test/**/*.{ts,tsx}",
    ],
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
            "expectContentAddressedArtifact",
            "expectExistingArtifactVerification",
            "expectSymlinkedArtifactRefusal",
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
    files: ["packages/testkit/src/contract_oracle.ts"],
    linterOptions: { noInlineConfig: true },
    plugins: { "oracle-independence": oracleIndependencePlugin },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*"],
              message: "The contract oracle must not import or re-export dependencies.",
            },
          ],
        },
      ],
      "oracle-independence/no-dependency-loading": "error",
      // The oracle mirrors deployed Rust control flow; restructuring it for this metric harms auditability.
      "sonarjs/cognitive-complexity": "off",
    },
  },
);
