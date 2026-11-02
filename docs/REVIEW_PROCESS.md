# Self-review process (before anything reaches `main`)

`main` only receives squash-merged PRs. Every PR goes through these gates in order:

1. **Author agent self-check**
   - `pnpm verify` is green locally.
   - The agent re-reads its own diff (`git diff main...HEAD`) against `REVIEW_CHECKLIST.md`.
   - New behavior has tests.
2. **CI** (`.github/workflows/ci.yml`) must be green:
   - `lint` and `typecheck`
   - `unit`, which includes the engine property tests
   - `sim` (bot-vs-bot games)
   - `build`
   - `e2e` (Playwright)
3. **Reviewer agent.** A separate agent, not the author, runs the review:
   - `/code-review` on the PR branch, looking for correctness bugs.
   - `/security-review` if the PR touches `apps/server`, auth, sockets, voice, or `engine/view.ts`.
   - The author fixes each finding, or the reviewer documents why it doesn't apply.
4. **Review summary comment** on the PR: the findings, how each was resolved, and the checklist ticked.
5. **Squash merge.** Then delete the branch, and rebase the other open workstream branches onto `main`.

## Branch protection (owner action)

Branch protection and rulesets on **private** repos need GitHub Pro/Team. On a Pro/Team plan, run:

```bash
gh api -X PUT repos/huyen89/catan/branches/main/protection --input docs/branch-protection.json
```

On the Free plan, the gate is procedural: only merge with green CI, using squash, and never push to `main` directly.
