import { glob, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Treeshake probe (docs/stack-rewrite/decisions.md, amendment 12).
 *
 * Three deterministic checks, pinned to the repo's rollup and esbuild
 * devDependencies:
 *
 * 1. Source scan: no `@__PURE__` annotation may appear inside a `static {}`
 *    block anywhere under `packages/*&#47;src` — rollup silently deletes the
 *    annotated call while keeping the class, producing runtime-broken
 *    entities (the codec application vanishes).
 * 2. Hazard reproducer: reproduces that breakage on a toy entity so the ban
 *    stays justified by executable evidence, not prose.
 * 3. Budget positive: a clean-layout module graph (entity module hosts only
 *    the entity) must let a one-symbol consumer bundle prune the entity
 *    entirely within a 2 KiB budget — the Phase-3a packed-artifact gate
 *    asserts the same budget against the merged package.
 */

const probeDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(probeDirectory, "../../../..");
const scratchDirectory = path.join(probeDirectory, "scratch");
const budgetBytes = 2048;

function fail(message: string): never {
  throw new Error(`treeshake probe: ${message}`);
}

function report(message: string): void {
  console.error(`treeshake probe: ${message}`);
}

/**
 * Extracts the full text of every `static {}` block via the TypeScript AST,
 * which lexes strings, comments, templates, and regexes correctly — a
 * hand-rolled brace counter is truncated by `const text = "}";`.
 */
function staticBlocks(source: string): string[] {
  const file = ts.createSourceFile("probe.ts", source, ts.ScriptTarget.Latest, true);
  const blocks: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassStaticBlockDeclaration(node)) {
      blocks.push(node.getFullText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return blocks;
}

const nestedControl = `class C {
  static {
    const inner = { nested: { deep: true } };
    /* @__PURE__ */ register(C, inner);
  }
}`;

const lexicalControl = `class C {
  static {
    const text = "}";
    /* @__PURE__ */ register(C, text);
  }
}`;

async function scanForPureInStaticBlocks(): Promise<void> {
  // Negative controls: nested braces, and a string containing a closing
  // brace — the latter truncates any lexically-naive brace counter before
  // the annotation.
  for (const control of [nestedControl, lexicalControl]) {
    if (staticBlocks(control).every((block) => !block.includes("@__PURE__"))) {
      fail("scanner negative control failed: PURE annotation not detected");
    }
  }

  const offenders: string[] = [];
  for await (const file of glob("packages/*/src/**/*.{ts,tsx}", {
    cwd: repositoryRoot,
  })) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Iterates the repo's own glob results under packages/*/src.
    const source = await readFile(path.join(repositoryRoot, file), "utf8");
    if (staticBlocks(source).some((block) => block.includes("@__PURE__"))) {
      offenders.push(file);
    }
  }
  if (offenders.length > 0) {
    fail(
      `@__PURE__ inside static {} blocks (runtime-breakage hazard): ${offenders.join(", ")}`,
    );
  }
  report(
    "no @__PURE__ inside static blocks (TypeScript AST scan; nested-brace and lexical negative controls passed)",
  );
}

const hazardCodec = `const registry = new Set();
export function register(target) { registry.add(target.name); }
export function isRegistered(name) { return registry.has(name); }
`;

const hazardEntity = `import { register } from "./codec.js";
export const XBase = /* @__PURE__ */ (() => class {})();
export class X extends XBase {
  static { /* @__PURE__ */ register(X); }
}
`;

const hazardEntry = `import { X } from "./entity.js";
import { isRegistered } from "./codec.js";
export const instance = new X();
export const registered = isRegistered("X");
`;

async function reproduceHazard(): Promise<void> {
  const dir = path.join(scratchDirectory, "hazard");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "codec.js"), hazardCodec);
  await writeFile(path.join(dir, "entity.js"), hazardEntity);
  await writeFile(path.join(dir, "entry.js"), hazardEntry);

  const { rollup } = await import("rollup");
  // moduleSideEffects:false is a common aggressive consumer configuration;
  // under it rollup keeps the used class but EMPTIES its static block,
  // deleting the PURE-annotated codec application — the runtime breakage
  // the source-scan ban exists to prevent (defaults keep the call; the
  // hazard is config-conditional but outside our control).
  const build = await rollup({
    input: path.join(dir, "entry.js"),
    treeshake: { moduleSideEffects: false },
    onwarn(warning) {
      fail(`rollup warning treated as fatal: ${warning.message}`);
    },
  });
  const { output } = await build.generate({ format: "esm" });
  await build.close();
  const bundle = output[0].code;
  if (!bundle.includes("class X")) {
    fail("hazard reproducer expected class X to be retained");
  }
  if (bundle.includes("register(X)")) {
    fail(
      "hazard no longer reproduces: rollup kept the PURE-annotated static-block call; revisit the ban",
    );
  }
  report(
    "hazard reproduced (rollup drops the PURE-annotated codec application while keeping the class)",
  );
}

const cleanEntity = `export class Entity {
  static { Entity.registered = true; }
}
`;

const cleanHelper = `export function unrelatedHelper() { return "unrelated-marker"; }
`;

const cleanBarrel = `export { Entity } from "./entity.js";
export { unrelatedHelper } from "./helper.js";
`;

const cleanEntry = `export { unrelatedHelper } from "./barrel.js";
`;

async function assertBudget(): Promise<void> {
  const dir = path.join(scratchDirectory, "clean");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "entity.js"), cleanEntity);
  await writeFile(path.join(dir, "helper.js"), cleanHelper);
  await writeFile(path.join(dir, "barrel.js"), cleanBarrel);
  await writeFile(path.join(dir, "entry.js"), cleanEntry);

  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [path.join(dir, "entry.js")],
    bundle: true,
    format: "esm",
    treeShaking: true,
    write: false,
    logLevel: "silent",
  });
  const bundle = new TextDecoder().decode(result.outputFiles[0]?.contents);
  if (!bundle.includes("unrelated-marker")) {
    fail(
      "budget probe did not retain the imported helper (unresolved-import false success?)",
    );
  }
  if (bundle.includes("class Entity")) {
    fail("budget probe retained the entity from a clean-layout module graph");
  }
  if (Buffer.byteLength(bundle) > budgetBytes) {
    fail(
      `budget probe exceeded ${String(budgetBytes)} bytes: ${String(Buffer.byteLength(bundle))}`,
    );
  }
  report(
    `clean layout prunes the entity within budget (${String(Buffer.byteLength(bundle))} bytes)`,
  );
}

try {
  await scanForPureInStaticBlocks();
  await reproduceHazard();
  await assertBudget();
} finally {
  await rm(scratchDirectory, { recursive: true, force: true });
}
