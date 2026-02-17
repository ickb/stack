#!/usr/bin/env node

// tsc wrapper that filters diagnostics from CCC source files.
//
// Stack packages import CCC .ts source directly for real-time type feedback
// across the CCC/stack boundary. This means tsc checks CCC files under the
// stack's stricter tsconfig (verbatimModuleSyntax, noImplicitOverride,
// noUncheckedIndexedAccess) — rules CCC doesn't follow. These aren't real
// integration errors, just tsconfig-strictness mismatches.
//
// This wrapper:
//   1. Overrides noEmitOnError so CCC diagnostics don't block emit
//   2. Emits .js + .d.ts output normally
//   3. Reports only diagnostics from stack source files
//   4. Exits non-zero only on real stack errors

import ts from "typescript";

const configPath = ts.findConfigFile("./", ts.sys.fileExists);
if (!configPath) {
  console.error("tsconfig.json not found");
  process.exit(1);
}

const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, "./");
parsed.options.noEmitOnError = false;

const program = ts.createProgram(parsed.fileNames, parsed.options);
const emitResult = program.emit();

const diagnostics = [
  ...ts.getPreEmitDiagnostics(program),
  ...emitResult.diagnostics,
].filter((d) => !d.file?.fileName.includes("/ccc-dev/ccc/"));

if (diagnostics.length > 0) {
  const host = {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  };
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
  process.exit(1);
}
