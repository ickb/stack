# AI Coworker Configuration

## Meta

- **Learn**: When a non-obvious constraint causes a failure or surprises you, leave a concise note here and a detailed comment at the relevant location
- `CLAUDE.md` is a symlink to this file, created by `pnpm coworker`
- Refer to yourself as "AI Coworker" in docs and comments, not by product or company name
- Never add AI tool attribution or branding to PR descriptions, commit messages, or code comments
- Do not install or use `gh` CLI
- When a post-plan fix changes a documented decision, update the planning docs in the same commit

## Knowledge

- **Fork Management**: Before working in `forks/`, read `forks/forker/README.md` for directory structure, pin format, and workflows
- Use `git -C <path>` to run git commands in fork clones or other repos — never `cd` into them
- Always compare CKB scripts using full `Script.eq()` (codeHash + hashType + args), never just `codeHash`. Partial comparison silently matches wrong scripts

## PR Workflow

1. **Routine Pre-PR Validation**: `pnpm check:full`, it wipes derived state and regenerates from scratch. If any fork clone has pending work, the wipe is skipped to prevent data loss — re-record or push fork changes first for a clean validation
2. **Open a PR**: If any package needs a version bump, run `pnpm changeset` first. Push the branch and present a clickable markdown link `[title](url)` where the URL is a GitHub compare URL (`quick_pull=1`). Base branch is `master`. Prefill "title" (concise, under 70 chars) and "body" (markdown with ## Why and ## Changes sections)
3. **Fetch PR review comments**: Use the GitHub REST API via curl. Fetch all three comment types (issue comments, reviews, and inline comments). Categorize feedback by actionability (action required / informational), not by source (human / bot)
4. **Copy to clipboard replies**:

```sh
head -c -1 <<'EOF' | wl-copy
@account-name content goes here
EOF
```
