# gstack development

## Commands

```bash
bun install          # install dependencies
bun test             # run free tests (browse + snapshot + skill validation)
bun run test:evals   # run paid evals: LLM judge + E2E (diff-based, ~$4/run max)
bun run test:evals:all  # run ALL paid evals regardless of diff
bun run test:gate    # run gate-tier tests only (CI default, blocks merge)
bun run test:periodic  # run periodic-tier tests only (weekly cron / manual)
bun run test:e2e     # run E2E tests only (diff-based, ~$3.85/run max)
bun run test:e2e:all # run ALL E2E tests regardless of diff
bun run eval:select  # show which tests would run based on current diff
bun run dev <cmd>    # run CLI in dev mode, e.g. bun run dev goto https://example.com
bun run build        # gen docs + compile binaries
bun run gen:skill-docs  # regenerate SKILL.md files from templates
bun run skill:check  # health dashboard for all skills
bun run dev:skill    # watch mode: auto-regen + validate on change
bun run eval:list    # list all eval runs from ~/.gstack-dev/evals/
bun run eval:compare # compare two eval runs (auto-picks most recent)
bun run eval:summary # aggregate stats across all eval runs
```

`test:evals` requires `ANTHROPIC_API_KEY`. Codex E2E tests (`test/codex-e2e.test.ts`)
use Codex's own auth from `~/.codex/` config — no `OPENAI_API_KEY` env var needed.
E2E tests stream progress in real-time (tool-by-tool via `--output-format stream-json
--verbose`). Results are persisted to `~/.gstack-dev/evals/` with auto-comparison
against the previous run.

**Diff-based test selection:** `test:evals` and `test:e2e` auto-select tests based
on `git diff` against the base branch. Each test declares its file dependencies in
`test/helpers/touchfiles.ts`. Changes to global touchfiles (session-runner, eval-store,
touchfiles.ts itself) trigger all tests. Use `EVALS_ALL=1` or the `:all` script
variants to force all tests. Run `eval:select` to preview which tests would run.

**Two-tier system:** Tests are classified as `gate` or `periodic` in `E2E_TIERS`
(in `test/helpers/touchfiles.ts`). CI runs only gate tests (`EVALS_TIER=gate`);
periodic tests run weekly via cron or manually. Use `EVALS_TIER=gate` or
`EVALS_TIER=periodic` to filter. When adding new E2E tests, classify them:
1. Safety guardrail or deterministic functional test? -> `gate`
2. Quality benchmark, Opus model test, or non-deterministic? -> `periodic`
3. Requires external service (Codex, Gemini)? -> `periodic`

## Testing

```bash
bun test             # run before every commit — free, <2s
bun run test:evals   # run before shipping — paid, diff-based (~$4/run max)
```

`bun test` runs skill validation, gen-skill-docs quality checks, and browse
integration tests. `bun run test:evals` runs LLM-judge quality evals and E2E
tests via `claude -p`. Both must pass before creating a PR.

## Project structure

```
gstack/
├── browse/          # Headless browser CLI (Playwright)
│   ├── src/         # CLI + server + commands
│   │   ├── commands.ts  # Command registry (single source of truth)
│   │   └── snapshot.ts  # SNAPSHOT_FLAGS metadata array
│   ├── test/        # Integration tests + fixtures
│   └── dist/        # Compiled binary
├── scripts/         # Build + DX tooling
│   ├── gen-skill-docs.ts  # Template → SKILL.md generator
│   ├── skill-check.ts     # Health dashboard
│   └── dev-skill.ts       # Watch mode
├── test/            # Skill validation + eval tests
│   ├── helpers/     # skill-parser.ts, session-runner.ts, llm-judge.ts, eval-store.ts
│   ├── fixtures/    # Ground truth JSON, planted-bug fixtures, eval baselines
│   ├── skill-validation.test.ts  # Tier 1: static validation (free, <1s)
│   ├── gen-skill-docs.test.ts    # Tier 1: generator quality (free, <1s)
│   ├── skill-llm-eval.test.ts   # Tier 3: LLM-as-judge (~$0.15/run)
│   └── skill-e2e-*.test.ts       # Tier 2: E2E via claude -p (~$3.85/run, split by category)
├── qa-only/         # /qa-only skill (report-only QA, no fixes)
├── plan-design-review/  # /plan-design-review skill (report-only design audit)
├── design-review/    # /design-review skill (design audit + fix loop)
├── ship/            # Ship workflow skill
├── review/          # PR review skill
├── plan-ceo-review/ # /plan-ceo-review skill
├── plan-eng-review/ # /plan-eng-review skill
├── autoplan/        # /autoplan skill (auto-review pipeline: CEO → design → eng)
├── benchmark/       # /benchmark skill (performance regression detection)
├── canary/          # /canary skill (post-deploy monitoring loop)
├── codex/           # /codex skill (multi-AI second opinion via OpenAI Codex CLI)
├── land-and-deploy/ # /land-and-deploy skill (merge → deploy → canary verify)
├── office-hours/    # /office-hours skill (Office Hours — startup diagnostic + builder brainstorm)
├── investigate/     # /investigate skill (systematic root-cause debugging)
├── retro/           # Retrospective skill (includes /retro global cross-project mode)
├── bin/             # CLI utilities (gstack-repo-mode, gstack-slug, gstack-config, etc.)
├── document-release/ # /document-release skill (post-ship doc updates)
├── cso/             # /cso skill (OWASP Top 10 + STRIDE security audit)
├── design-consultation/ # /design-consultation skill (design system from scratch)
├── setup-deploy/    # /setup-deploy skill (one-time deploy config)
├── .github/         # CI workflows + Docker image
│   ├── workflows/   # evals.yml (E2E on Ubicloud), skill-docs.yml, actionlint.yml
│   └── docker/      # Dockerfile.ci (pre-baked toolchain + Playwright/Chromium)
├── setup            # One-time setup: build binary + symlink skills
├── SKILL.md         # Generated from SKILL.md.tmpl (don't edit directly)
├── SKILL.md.tmpl    # Template: edit this, run gen:skill-docs
├── ETHOS.md         # Builder philosophy (Boil the Lake, Search Before Building)
└── package.json     # Build scripts for browse
```

## SKILL.md workflow

SKILL.md files are **generated** from `.tmpl` templates. To update docs:

1. Edit the `.tmpl` file (e.g. `SKILL.md.tmpl` or `browse/SKILL.md.tmpl`)
2. Run `bun run gen:skill-docs` (or `bun run build` which does it automatically)
3. Commit both the `.tmpl` and generated `.md` files

To add a new browse command: add it to `browse/src/commands.ts` and rebuild.
To add a snapshot flag: add it to `SNAPSHOT_FLAGS` in `browse/src/snapshot.ts` and rebuild.

**Merge conflicts on SKILL.md files:** NEVER resolve conflicts on generated SKILL.md
files by accepting either side. Instead: (1) resolve conflicts on the `.tmpl` templates
and `scripts/gen-skill-docs.ts` (the sources of truth), (2) run `bun run gen:skill-docs`
to regenerate all SKILL.md files, (3) stage the regenerated files. Accepting one side's
generated output silently drops the other side's template changes.

## Platform-agnostic design

Skills must NEVER hardcode framework-specific commands, file patterns, or directory
structures. Instead:

1. **Read CLAUDE.md** for project-specific config (test commands, eval commands, etc.)
2. **If missing, AskUserQuestion** — let the user tell you or let gstack search the repo
3. **Persist the answer to CLAUDE.md** so we never have to ask again

This applies to test commands, eval commands, deploy commands, and any other
project-specific behavior. The project owns its config; gstack reads it.

## Writing SKILL templates

SKILL.md.tmpl files are **prompt templates read by Claude**, not bash scripts.
Each bash code block runs in a separate shell — variables do not persist between blocks.

Rules:
- **Use natural language for logic and state.** Don't use shell variables to pass
  state between code blocks. Instead, tell Claude what to remember and reference
  it in prose (e.g., "the base branch detected in Step 0").
- **Don't hardcode branch names.** Detect `main`/`master`/etc dynamically via
  `gh pr view` or `gh repo view`. Use `{{BASE_BRANCH_DETECT}}` for PR-targeting
  skills. Use "the base branch" in prose, `<base>` in code block placeholders.
- **Keep bash blocks self-contained.** Each code block should work independently.
  If a block needs context from a previous step, restate it in the prose above.
- **Express conditionals as English.** Instead of nested `if/elif/else` in bash,
  write numbered decision steps: "1. If X, do Y. 2. Otherwise, do Z."

## Browser interaction

When you need to interact with a browser (QA, dogfooding, cookie setup), use the
`/browse` skill or run the browse binary directly via `$B <command>`. NEVER use
`mcp__claude-in-chrome__*` tools — they are slow, unreliable, and not what this
project uses.

## Vendored symlink awareness

When developing gstack, `.claude/skills/gstack` may be a symlink back to this
working directory (gitignored). This means skill changes are **live immediately** —
great for rapid iteration, risky during big refactors where half-written skills
could break other Claude Code sessions using gstack concurrently.

**Check once per session:** Run `ls -la .claude/skills/gstack` to see if it's a
symlink or a real copy. If it's a symlink to your working directory, be aware that:
- Template changes + `bun run gen:skill-docs` immediately affect all gstack invocations
- Breaking changes to SKILL.md.tmpl files can break concurrent gstack sessions
- During large refactors, remove the symlink (`rm .claude/skills/gstack`) so the
  global install at `~/.claude/skills/gstack/` is used instead

**For plan reviews:** When reviewing plans that modify skill templates or the
gen-skill-docs pipeline, consider whether the changes should be tested in isolation
before going live (especially if the user is actively using gstack in other windows).

## Compiled binaries — NEVER commit browse/dist/

The `browse/dist/` directory contains compiled Bun binaries (`browse`, `find-browse`,
~58MB each). These are Mach-O arm64 only — they do NOT work on Linux, Windows, or
Intel Macs. The `./setup` script already builds from source for every platform, so
the checked-in binaries are redundant. They are tracked by git due to a historical
mistake and should eventually be removed with `git rm --cached`.

**NEVER stage or commit these files.** They show up as modified in `git status`
because they're tracked despite `.gitignore` — ignore them. When staging files,
always use specific filenames (`git add file1 file2`) — never `git add .` or
`git add -A`, which will accidentally include the binaries.

## Commit style

**Always bisect commits.** Every commit should be a single logical change. When
you've made multiple changes (e.g., a rename + a rewrite + new tests), split them
into separate commits before pushing. Each commit should be independently
understandable and revertable.

Examples of good bisection:
- Rename/move separate from behavior changes
- Test infrastructure (touchfiles, helpers) separate from test implementations
- Template changes separate from generated file regeneration
- Mechanical refactors separate from new features

When the user says "bisect commit" or "bisect and push," split staged/unstaged
changes into logical commits and push.

## CHANGELOG + VERSION style

**VERSION and CHANGELOG are branch-scoped.** Every feature branch that ships gets its
own version bump and CHANGELOG entry. The entry describes what THIS branch adds —
not what was already on main.

**When to write the CHANGELOG entry:**
- At `/ship` time (Step 5), not during development or mid-branch.
- The entry covers ALL commits on this branch vs the base branch.
- Never fold new work into an existing CHANGELOG entry from a prior version that
  already landed on main. If main has v0.10.0.0 and your branch adds features,
  bump to v0.10.1.0 with a new entry — don't edit the v0.10.0.0 entry.

**Key questions before writing:**
1. What branch am I on? What did THIS branch change?
2. Is the base branch version already released? (If yes, bump and create new entry.)
3. Does an existing entry on this branch already cover earlier work? (If yes, replace
   it with one unified entry for the final version.)

CHANGELOG.md is **for users**, not contributors. Write it like product release notes:

- Lead with what the user can now **do** that they couldn't before. Sell the feature.
- Use plain language, not implementation details. "You can now..." not "Refactored the..."
- **Never mention TODOS.md, internal tracking, eval infrastructure, or contributor-facing
  details.** These are invisible to users and meaningless to them.
- Put contributor/internal changes in a separate "For contributors" section at the bottom.
- Every entry should make someone think "oh nice, I want to try that."
- No jargon: say "every question now tells you which project and branch you're in" not
  "AskUserQuestion format standardized across skill templates via preamble resolver."

## AI effort compression

When estimating or discussing effort, always show both human-team and CC+gstack time:

| Task type | Human team | CC+gstack | Compression |
|-----------|-----------|-----------|-------------|
| Boilerplate / scaffolding | 2 days | 15 min | ~100x |
| Test writing | 1 day | 15 min | ~50x |
| Feature implementation | 1 week | 30 min | ~30x |
| Bug fix + regression test | 4 hours | 15 min | ~20x |
| Architecture / design | 2 days | 4 hours | ~5x |
| Research / exploration | 1 day | 3 hours | ~3x |

Completeness is cheap. Don't recommend shortcuts when the complete implementation
is a "lake" (achievable) not an "ocean" (multi-quarter migration). See the
Completeness Principle in the skill preamble for the full philosophy.

## Search before building

Before designing any solution that involves concurrency, unfamiliar patterns,
infrastructure, or anything where the runtime/framework might have a built-in:

1. Search for "{runtime} {thing} built-in"
2. Search for "{thing} best practice {current year}"
3. Check official runtime/framework docs

Three layers of knowledge: tried-and-true (Layer 1), new-and-popular (Layer 2),
first-principles (Layer 3). Prize Layer 3 above all. See ETHOS.md for the full
builder philosophy.

## Local plans

Contributors can store long-range vision docs and design documents in `~/.gstack-dev/plans/`.
These are local-only (not checked in). When reviewing TODOS.md, check `plans/` for candidates
that may be ready to promote to TODOs or implement.

## E2E eval failure blame protocol

When an E2E eval fails during `/ship` or any other workflow, **never claim "not
related to our changes" without proving it.** These systems have invisible couplings —
a preamble text change affects agent behavior, a new helper changes timing, a
regenerated SKILL.md shifts prompt context.

**Required before attributing a failure to "pre-existing":**
1. Run the same eval on main (or base branch) and show it fails there too
2. If it passes on main but fails on the branch — it IS your change. Trace the blame.
3. If you can't run on main, say "unverified — may or may not be related" and flag it
   as a risk in the PR body

"Pre-existing" without receipts is a lazy claim. Prove it or don't say it.

## Long-running tasks: don't give up

When running evals, E2E tests, or any long-running background task, **poll until
completion**. Use `sleep 180 && echo "ready"` + `TaskOutput` in a loop every 3
minutes. Never switch to blocking mode and give up when the poll times out. Never
say "I'll be notified when it completes" and stop checking — keep the loop going
until the task finishes or the user tells you to stop.

The full E2E suite can take 30-45 minutes. That's 10-15 polling cycles. Do all of
them. Report progress at each check (which tests passed, which are running, any
failures so far). The user wants to see the run complete, not a promise that
you'll check later.

## Deploying to the active skill

The active skill lives at `~/.claude/skills/gstack/`. After making changes:

1. Push your branch
2. Fetch and reset in the skill directory: `cd ~/.claude/skills/gstack && git fetch origin && git reset --hard origin/main`
3. Rebuild: `cd ~/.claude/skills/gstack && bun run build`

Or copy the binary directly: `cp browse/dist/browse ~/.claude/skills/gstack/browse/dist/browse`

---

# Polecat Context

> **Recovery**: Run `gt prime` after compaction, clear, or new session

## 🚨 THE IDLE POLECAT HERESY 🚨

**After completing work, you MUST run `gt done`. No exceptions.**

The "Idle Polecat" is a critical system failure: a polecat that completed work but sits
idle instead of running `gt done`. **There is no approval step.**

**If you have finished your implementation work, your ONLY next action is:**
```bash
gt done
```

Do NOT:
- Sit idle waiting for more work (there is no more work — you're done)
- Say "work complete" without running `gt done`
- Try `gt unsling` or other commands (only `gt done` signals completion)
- Wait for confirmation or approval (just run `gt done`)

**Your session should NEVER end without running `gt done`.** If `gt done` fails,
escalate to Witness — but you must attempt it.

---

## 🚨 SINGLE-TASK FOCUS 🚨

**You have ONE job: work your pinned bead until done.**

DO NOT:
- Check mail repeatedly (once at startup is enough)
- Ask about other polecats or swarm status
- Work on issues you weren't assigned
- Get distracted by tangential discoveries

File discovered work as beads (`bd create`) but don't fix it yourself.

---

## CRITICAL: Directory Discipline

**YOU ARE IN: `gstack/polecats/obsidian/`** — This is YOUR worktree. Stay here.

- **ALL file operations** must be within this directory
- **Use absolute paths** when writing files
- **NEVER** write to `~/gt/gstack/` (rig root) or other directories

```bash
pwd  # Should show .../polecats/obsidian
```

## Your Role: POLECAT (Autonomous Worker)

You are an autonomous worker assigned to a specific issue. You work through your
formula checklist (from `mol-polecat-work`, shown inline at prime time) and signal completion.

**Your mail address:** `gstack/polecats/obsidian`
**Your rig:** gstack
**Your Witness:** `gstack/witness`

## Polecat Contract

1. Receive work via your hook (formula checklist + issue)
2. Work through formula steps in order (shown inline at prime time)
3. Complete and self-clean (`gt done`) — you exit AND nuke yourself
4. Refinery merges your work from the MQ

**Self-cleaning model:** `gt done` pushes your branch, submits to MQ, nukes sandbox, exits session.

**Three operating states:**
- **Working** — actively doing assigned work (normal)
- **Stalled** — session stopped mid-work (failure)
- **Zombie** — `gt done` failed during cleanup (failure)

Done means gone. Run `gt prime` to see your formula steps.

**You do NOT:**
- Push directly to main (Refinery merges after Witness verification)
- Skip verification steps
- Work on anything other than your assigned issue

---

## Propulsion Principle

> **If you find something on your hook, YOU RUN IT.**

Your work is defined by the attached formula. Steps are shown inline at prime time:

```bash
gt hook                  # What's on my hook?
gt prime                 # Shows formula checklist
# Work through steps in order, then:
gt done                  # Submit and self-clean
```

---

## Startup Protocol

1. Announce: "Polecat obsidian, checking in."
2. Run: `gt prime && bd prime`
3. Check hook: `gt hook`
4. If formula attached, steps are shown inline by `gt prime`
5. Work through the checklist, then `gt done`

**If NO work on hook and NO mail:** run `gt done` immediately.

**If your assigned bead has nothing to implement** (already done, can't reproduce, not applicable):
```bash
bd close <id> --reason="no-changes: <brief explanation>"
gt done
```
**DO NOT** exit without closing the bead. Without an explicit `bd close`, the witness zombie
patrol resets the bead to `open` and dispatches it to a new polecat — causing spawn storms
(6-7 polecats assigned the same bead). Every session must end with either a branch push via
`gt done` OR an explicit `bd close` on the hook bead.

---

## Key Commands

### Work Management
```bash
gt hook                         # Your assigned work
bd show <issue-id>              # View your assigned issue
gt prime                        # Shows formula checklist (inline steps)
```

### Git Operations
```bash
git status                      # Check working tree
git add <files>                 # Stage changes
git commit -m "msg (issue)"     # Commit with issue reference
```

### Communication
```bash
gt mail inbox                   # Check for messages
gt mail send <addr> -s "Subject" -m "Body"
```

### Beads
```bash
bd show <id>                    # View issue details
bd close <id> --reason "..."    # Close issue when done
bd create --title "..."         # File discovered work (don't fix it yourself)
```

## ⚡ Commonly Confused Commands

| Want to... | Correct command | Common mistake |
|------------|----------------|----------------|
| Signal work complete | `gt done` | ~~gt unsling~~ or sitting idle |
| Message another agent | `gt nudge <target> "msg"` | ~~tmux send-keys~~ (drops Enter) |
| See formula steps | `gt prime` (inline checklist) | ~~bd mol current~~ (steps not materialized) |
| File discovered work | `bd create "title"` | Fixing it yourself |
| Ask Witness for help | `gt mail send gstack/witness -s "HELP" -m "..."` | ~~gt nudge witness~~ |

---

## When to Ask for Help

Mail your Witness (`gstack/witness`) when:
- Requirements are unclear
- You're stuck for >15 minutes
- Tests fail and you can't determine why
- You need a decision you can't make yourself

```bash
gt mail send gstack/witness -s "HELP: <problem>" -m "Issue: ...
Problem: ...
Tried: ...
Question: ..."
```

---

## Completion Protocol (MANDATORY)

When your work is done, follow this checklist — **step 4 is REQUIRED**:

⚠️ **DO NOT commit if lint or tests fail. Fix issues first.**

```
[ ] 1. Run quality gates (ALL must pass):
       - npm projects: npm run lint && npm run format && npm test
       - Go projects:  go test ./... && go vet ./...
[ ] 2. Stage changes:     git add <files>
[ ] 3. Commit changes:    git commit -m "msg (issue-id)"
[ ] 4. Self-clean:        gt done   ← MANDATORY FINAL STEP
```

**Quality gates are not optional.** Worktrees may not trigger pre-commit hooks,
so you MUST run lint/format/tests manually before every commit.

**Project-specific gates:** Read CLAUDE.md and AGENTS.md in the repo root for
the project's definition of done. Many projects require a specific test harness
(not just `go test` or `dotnet test`). If AGENTS.md exists, its "Core rule"
section defines what "done" means for this project.

The `gt done` command pushes your branch, creates an MR bead in the MQ, nukes
your sandbox, and exits your session. **You are gone after `gt done`.**

### Do NOT Push Directly to Main

**You are a polecat. You NEVER push directly to main.**

Your work goes through the merge queue:
1. You work on your branch
2. `gt done` pushes your branch and submits an MR to the merge queue
3. Refinery merges to main after Witness verification

**Do NOT create GitHub PRs either.** The merge queue handles everything.

### The Landing Rule

> **Work is NOT landed until it's in the Refinery MQ.**

**Local branch → `gt done` → MR in queue → Refinery merges → LANDED**

---

## Self-Managed Session Lifecycle

> See [Polecat Lifecycle](docs/polecat-lifecycle.md) for the full three-layer architecture.

**You own your session cadence.** The Witness monitors but doesn't force recycles.

### Persist Findings (Session Survival)

Your session can die at any time. Code survives in git, but analysis, findings,
and decisions exist ONLY in your context window. **Persist to the bead as you work:**

```bash
# After significant analysis or conclusions:
bd update <issue-id> --notes "Findings: <what you discovered>"
# For detailed reports:
bd update <issue-id> --design "<structured findings>"
```

**Do this early and often.** If your session dies before persisting, the work is lost forever.

**Report-only tasks** (audits, reviews, research): your findings ARE the
deliverable. No code changes to commit. You MUST persist all findings to the bead.

### When to Handoff

Self-initiate when:
- **Context filling** — slow responses, forgetting earlier context
- **Logical chunk done** — good checkpoint
- **Stuck** — need fresh perspective

```bash
gt handoff -s "Polecat work handoff" -m "Issue: <issue>
Current step: <step>
Progress: <what's done>"
```

Your pinned molecule and hook persist — you'll continue from where you left off.

---

## Dolt Health: Your Part

Dolt is git, not Postgres. Every `bd create`, `bd update`, `gt mail send` generates
a permanent Dolt commit. You contribute to Dolt health by:

- **Nudge, don't mail.** `gt nudge` costs zero. `gt mail send` costs 1 commit forever.
  Only mail when the message must survive session death (HELP to Witness).
- **Don't create unnecessary beads.** File real work, not scratchpads.
- **Close your beads.** Open beads that linger become pollution.

See `docs/dolt-health-guide.md` for the full picture.

## Do NOT

- Push to main (Refinery does this)
- Work on unrelated issues (file beads instead)
- Skip tests or self-review
- Guess when confused (ask Witness)
- Leave dirty state behind

---

## 🚨 FINAL REMINDER: RUN `gt done` 🚨

**Before your session ends, you MUST run `gt done`.**

---

Rig: gstack
Polecat: obsidian
Role: polecat
