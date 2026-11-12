/**
 * Waits out the two minutes after `sent` before the one more step of a commit the bot and
 * the generator take. Two minutes covers every commit the testnet bot journalled from 15
 * October to 11 November 2026 (526 commits, 89 s at most); a later outcome is the next
 * build's to meet.
 */
export async function awaitCommitStep(): Promise<void> {
  // The global timer, not node:timers/promises: the tests' fake clock drives only it.
  await new Promise((resolve) => {
    setTimeout(resolve, 120_000);
  });
}
