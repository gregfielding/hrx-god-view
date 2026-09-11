# Jest workers exhausted the Mac's memory (2026-09-11)

> `functions/` jest had no worker cap: jest started one worker per CPU core minus one (13 on Greg's 14-core, 24 GB Mac), and each ts-jest worker grew to 2–3 GB. One run reached ~31 GB and filled swap. It's now capped with `maxWorkers: 2` + `workerIdleMemoryLimit: '1GB'` in `functions/jest.config.js`.

**What happened:** a Claude session ran
`npx jest src/__tests__/cadence src/__tests__/natalie src/__tests__/integrations …`.
Jest's default pool is `cores − 1` workers. Each worker compiles the functions
TypeScript graph through ts-jest and holds it, so every worker settled at
2.3–3.1 GB (most of it compressed or swapped). Thirteen of them came to ~31 GB
on a 24 GB machine: swap 25.3 of 26.6 GB, macOS "out of memory". The run sat
for ~20 minutes with 11 of 13 workers idle. Even a 2-file run started 13
workers, and two of them reached 2.3 GB.

**The fix (`functions/jest.config.js`):**
- `maxWorkers: 2` — peak is about 2 × one worker's footprint (~5 GB), not 13×.
- `workerIdleMemoryLimit: '1GB'` (Jest ≥ 29.3; installed 29.7) — a worker that
  passes 1 GB after a test file is restarted, so memory doesn't ratchet up
  across a long run.
- Why this low: this Mac routinely runs 10+ Claude sessions at once, plus the
  iOS simulators, Xcode and Chrome. Test speed matters less than the machine
  staying usable.

**Running tests:**
- One or two files: `npx jest --runInBand <files>` (no pool at all).
- `--maxWorkers=N` on the command line overrides the config — only raise it
  when nothing else heavy is running, and never to the default.
- `npm test` is plain `jest` (since 2026-09-11, so these caps apply to it).
  It used to run mocha over the same files, but mocha aborted at load on the
  jest-only specs. `npm run test:jest` is the full run with the Firestore
  emulator suites; see feedback_functions_emulator_tests.md.

**Diagnosing next time:**
- `top -l 1 -o mem -stats pid,ppid,command,mem,cmprs` shows memory including
  compressed pages. `ps` RSS alone hides it: those workers looked like
  4–500 MB there.
- Jest workers show up as `node …/jest-worker/build/workers/processChild.js`;
  their parent is the `node …/.bin/jest …` process.
- ☠️ Match processes by their current command line right before killing, and
  check the start time. The runaway run had already exited, and a pattern
  match stopped that session's next, fresh run instead.
- ☠️ zsh doesn't word-split unquoted variables: `for p in $PIDS` is ONE
  iteration, and `kill "$p"` then fails with "illegal pid". Use `${=PIDS}`,
  or pipe through `xargs kill`.
