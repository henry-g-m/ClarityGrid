# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Git workflow

- Do not commit changes on your own. Make the edits, leave them uncommitted,
  and let the user review the diff (`git status` / `git diff`) before
  anything is committed.
- This applies even inside an isolated worktree: isolate the files if
  needed, but don't turn that into a new branch/commit/push cycle unless
  the user explicitly asks for one.
