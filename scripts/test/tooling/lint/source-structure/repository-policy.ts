import assert from "node:assert/strict";
import test from "node:test";
import type { Failure } from "../../../../tooling/lint/source-structure/model.ts";
import {
  checkWorkflowLocations,
  checkWorkflowSource,
  workflowFiles,
} from "../../../../tooling/lint/source-structure/repository.ts";

const checkWorkflow = ".github/workflows/check.yaml";
const nestedWorkflow = "apps/interface/.github/workflows/deploy.yml";
const rootNestedWorkflow = ".github/workflows/nested/check.yaml";

void test("finds inert nested workflows", () => {
  const files = workflowFiles([
    checkWorkflow,
    nestedWorkflow,
    rootNestedWorkflow,
    ".github/workflows/README.md",
    "apps/interface/src/main.tsx",
  ]);
  const failures: Failure[] = [];
  checkWorkflowLocations(files, failures);
  assert.deepEqual(files, [checkWorkflow, nestedWorkflow, rootNestedWorkflow]);
  assert.deepEqual(failures, [
    {
      rule: "nestedWorkflowLocation",
      file: nestedWorkflow,
    },
    {
      rule: "nestedWorkflowLocation",
      file: rootNestedWorkflow,
    },
  ]);
});

void test("requires least-privilege check workflow checkout", () => {
  const failures: Failure[] = [];
  checkWorkflowSource(
    checkWorkflow,
    `jobs:\n  build:\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n      - uses: owner/action@v1`,
    failures,
  );
  assert.deepEqual(
    failures.map(({ rule }) => rule),
    [
      "unpinnedWorkflowAction",
      "checkWorkflowPermissions",
      "checkoutCredentialPersistence",
    ],
  );
});

void test("accepts pinned actions with read-only non-persistent checkout", () => {
  const failures: Failure[] = [];
  checkWorkflowSource(
    checkWorkflow,
    `permissions:\n  contents: read\n\njobs:\n  build:\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n        with:\n          persist-credentials: false`,
    failures,
  );
  assert.deepEqual(failures, []);
});

void test("rejects job permission overrides", () => {
  const failures: Failure[] = [];
  checkWorkflowSource(
    checkWorkflow,
    `permissions: { contents: read }
jobs:
  build:
    permissions: write-all
    steps: []`,
    failures,
  );
  assert.deepEqual(
    failures.map(({ rule }) => rule),
    ["checkWorkflowPermissions"],
  );
});

void test("requires GitHub commit and Docker digest pins", () => {
  const failures: Failure[] = [];
  checkWorkflowSource(
    ".github/workflows/other.yaml",
    `jobs:
  build:
    steps:
      - uses: owner/action
      - uses: owner/action@v1
      - uses: docker://node:22
      - uses: owner/action@${"a".repeat(40)}
      - uses: docker://node@sha256:${"b".repeat(64)}`,
    failures,
  );
  assert.deepEqual(
    failures.map(({ action }) => action),
    ["owner/action", "owner/action@v1", "docker://node:22"],
  );
});

void test("ignores uses text inside multiline commands", () => {
  const failures: Failure[] = [];
  checkWorkflowSource(
    checkWorkflow,
    `permissions: { contents: read }
jobs:
  build:
    steps:
      - run: |
          uses: owner/action@v1`,
    failures,
  );
  assert.deepEqual(failures, []);
});

void test("ignores uses keys outside job and step action sites", () => {
  const failures: Failure[] = [];
  checkWorkflowSource(
    checkWorkflow,
    `permissions: { contents: read }
env:
  uses: owner/action@v1
jobs:
  build:
    steps:
      - run: true
        env: { uses: owner/action@v1 }`,
    failures,
  );
  assert.deepEqual(failures, []);
});
