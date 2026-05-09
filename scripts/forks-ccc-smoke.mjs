import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const targets = [
  {
    filter: "@ickb/utils",
    script:
      "const { ccc } = await import('@ckb-ccc/core'); if (!ccc) throw new Error('Missing ccc namespace export from @ckb-ccc/core'); const lock = ccc.Script.from({ codeHash: '0x' + '11'.repeat(32), hashType: 'type', args: '0x1234' }); if (!lock.eq({ codeHash: '0x' + '11'.repeat(32), hashType: 'type', args: '0x1234' })) throw new Error('Script equality rejected identical script'); if (lock.eq({ codeHash: '0x' + '11'.repeat(32), hashType: 'data1', args: '0x1234' })) throw new Error('Script equality ignored hashType'); const tx = ccc.Transaction.default(); tx.addOutput({ capacity: ccc.fixedPointFrom(100), lock }, '0x'); if (tx.outputs.length !== 1 || tx.outputsData[0] !== '0x') throw new Error('Transaction output construction failed'); if (!/^0x[0-9a-f]{64}$/.test(tx.hash())) throw new Error('Transaction hashing failed');",
  },
  {
    filter: "@ickb/core",
    script:
      "const { ccc } = await import('@ckb-ccc/core'); const { udt } = await import('@ckb-ccc/udt'); if (!udt) throw new Error('Missing udt namespace export from @ckb-ccc/udt'); const type = ccc.Script.from({ codeHash: '0x' + '22'.repeat(32), hashType: 'type', args: '0xab' }); const lock = ccc.Script.from({ codeHash: '0x' + '33'.repeat(32), hashType: 'type', args: '0x' }); const token = new udt.Udt({ txHash: '0x' + '44'.repeat(32), index: 0n }, type); const cell = ccc.Cell.from({ outPoint: { txHash: '0x' + '55'.repeat(32), index: 0n }, cellOutput: { capacity: ccc.fixedPointFrom(100), lock, type }, outputData: ccc.numLeToBytes(123n, 16) }); const info = await token.infoFrom({}, [cell]); if (info.balance !== 123n || info.count !== 1) throw new Error('UDT balance extraction failed');",
  },
  {
    filter: "interface",
    script:
      "const mod = await import('@ckb-ccc/ccc'); if (!('ccc' in mod) || !('JoyId' in mod) || !('Transaction' in mod)) throw new Error('Missing expected @ckb-ccc/ccc exports'); const lock = mod.ccc.Script.from({ codeHash: '0x' + '66'.repeat(32), hashType: 'type', args: '0x' }); const tx = mod.Transaction.default(); tx.addOutput({ capacity: mod.ccc.fixedPointFrom(61), lock }, '0x'); if (tx.outputs[0]?.capacity !== mod.ccc.fixedPointFrom(61)) throw new Error('@ckb-ccc/ccc transaction behavior failed');",
  },
];

for (const target of targets) {
  // Run the import from the real consumer package so resolution matches
  // the downstream path we want to validate, not the repo root.
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      target.filter,
      "exec",
      "node",
      "--input-type=module",
      "-e",
      target.script,
    ],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
