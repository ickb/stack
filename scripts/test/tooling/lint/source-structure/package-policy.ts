import assert from "node:assert/strict";
import test from "node:test";
import type {
  Failure,
  PackageMetadata,
} from "../../../../tooling/lint/source-structure/model.ts";
import { checkPackageRootCoverage } from "../../../../tooling/lint/source-structure/packages.ts";

const corePackage: PackageMetadata = {
  file: "packages/core/package.json",
  root: "packages/core",
  packageJson: {
    name: "@ickb/core",
    scripts: { build: "build", "lint:api": "api", "lint:publish": "publish" },
  },
};

void test("requires every release gate on publishable packages", () => {
  const failures: Failure[] = [];
  checkPackageRootCoverage(
    [
      {
        ...corePackage,
        packageJson: { ...corePackage.packageJson, scripts: { build: "build" } },
      },
    ],
    failures,
  );
  assert.deepEqual(
    failures.map(({ rule, script }) => ({ rule, script })),
    [
      { rule: "publishablePackageScript", script: "lint:api" },
      { rule: "publishablePackageScript", script: "lint:publish" },
    ],
  );
});

void test("accepts one package-owned script per release gate", () => {
  const failures: Failure[] = [];
  checkPackageRootCoverage([corePackage], failures);
  assert.deepEqual(failures, []);
});
