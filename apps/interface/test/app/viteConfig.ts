import { fileURLToPath } from "node:url";
import { build, normalizePath } from "vite";
import { describe, expect, it } from "vitest";
import { reactCompilerPackageExclusions } from "../../vite.config.ts";

describe("interface Vite config", () => {
  it("excludes absolute non-React package IDs from the React Compiler", async () => {
    const absoluteId = (relativePath: string): string =>
      normalizePath(
        fileURLToPath(new URL(`../../../../${relativePath}`, import.meta.url)),
      );
    const packageIds = ["core", "dao", "order", "sdk", "utils"].map((name) =>
      absoluteId(`packages/${name}/src/index.ts`),
    );
    const interfaceId = absoluteId("apps/interface/src/app/App.tsx");
    const entryIds = new Set([...packageIds, interfaceId]);
    const transformedIds: string[] = [];

    await build({
      configFile: false,
      logLevel: "silent",
      plugins: [
        {
          name: "absolute-id-fixtures",
          resolveId: {
            handler(id): string | undefined {
              return entryIds.has(id) ? id : undefined;
            },
          },
          load: {
            handler(id): string | undefined {
              return entryIds.has(id) ? "export default 1" : undefined;
            },
          },
        },
        {
          name: "react-compiler-filter-probe",
          transform: {
            filter: { id: { exclude: reactCompilerPackageExclusions } },
            handler(_code, id): void {
              transformedIds.push(id);
            },
          },
        },
      ],
      build: {
        write: false,
        rollupOptions: {
          input: Object.fromEntries([...entryIds].map((id, index) => [index, id])),
        },
      },
    });

    expect(transformedIds).toContain(interfaceId);
    expect(transformedIds.filter((id) => packageIds.includes(id))).toEqual([]);
  });
});
