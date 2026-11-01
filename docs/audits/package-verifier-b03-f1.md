# SHIVAX B03-F1 — Package verifier process execution

Date: 2026-11-01 (Asia/Calcutta). Package: `shivax@0.1.2`, unchanged.
Follow-up to the failed pnpm gate in [B04](build-stabilization-final.md).

## Root cause and failing command

The previous verifier used `process.env.npm_execpath` as if it were always npm's
JavaScript entrypoint. Its first child command was:

```text
<process.execPath> <npm_execpath> pack --ignore-scripts --json --pack-destination <temporary-directory>
```

On this Windows setup, `process.execPath` is Node's `node.exe`, while pnpm sets
`npm_execpath` to its native `pnpm.exe`. Passing that native executable to Node
as JavaScript caused `ERR_UNKNOWN_FILE_EXTENSION`. The same assumption also
affected the later temporary install command. `package.json` correctly invokes
the script with `node scripts/check-sdk-package.mjs`; that script entry was not
the cause and is unchanged.

Fixing only the executable dispatch would be insufficient: npm and pnpm return
different pack JSON shapes and accept different isolated install options.

## File changes in this phase

| File | Change |
| --- | --- |
| `scripts/check-sdk-package.mjs` | Select manager, dispatch it correctly, normalize pack metadata, validate the tarball path, use manager-specific offline installation |
| `scripts/package-process.mjs` | Shared direct process launcher, known-wrapper companion resolution, and complete failure diagnostics |
| `tests/package-process.test.mjs` | Eight process/argument/wrapper/error/cleanup regressions |
| `.github/workflows/package-verification.yml` | Linux/Windows matrix on Node 22/24/26, lint/test and both verifier invocations |
| `docs/audits/package-verifier-b03-f1.md` | This evidence and decision record |

No ML, RUDRA, specialists, firewall, licensing, runtime export, declaration,
version, or package-script changes were made in this phase. Earlier uncommitted
stabilization work was preserved. Historical B04 results remain unchanged as a
record of the failure before this fix.

## Corrected process handling

- An explicit absolute `SHIVAX_NPM_CLI` override takes precedence over
  `npm_execpath`. Normal npm/pnpm script invocation needs no override.
- `.js`, `.cjs`, and `.mjs` CLIs run through the current `process.execPath`.
- Native executables, including `.exe` and POSIX launchers, run directly.
  A native `pnpm.exe` is never a Node JavaScript entrypoint.
- Known `npm.cmd`/`.bat` and `pnpm.cmd`/`.bat` launchers resolve to adjacent
  npm/pnpm/Corepack JavaScript CLIs or pnpm's native executable. Wrapper text
  is not parsed or executed. Unknown/unresolvable wrappers fail with guidance
  to provide an explicit CLI path.
- All child execution uses argument arrays and `shell: false`, including paths
  with spaces or shell metacharacters. No command-string interpolation, batch
  command construction, hardcoded user directory, pnpm store path, or Node
  installation location was introduced.

Node documents that Windows batch launchers require special handling rather
than normal direct executable launch; resolving their actual CLI avoids a shell
entirely. See [Node child-process documentation](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows).

npm keeps the original offline, script-free `install` arguments. pnpm uses
`add --offline --ignore-scripts --ignore-workspace --lockfile=false
--config.auto-install-peers=false <tarball>`. Ignoring the enclosing workspace
keeps the nested temporary consumer isolated. Peer auto-installation is disabled
for that consumer; it is not a change to SHIVAX's published peer metadata.

Both managers pack with `--ignore-scripts --json --pack-destination`. npm's array
result and pnpm's object result normalize to the same verification workflow.
pnpm's absolute filename is handled correctly. The tarball must stay within
the exclusively created temporary directory. File count reporting accepts both
`entryCount` and `files.length`.

## Verification preserved

The verifier still packs the existing build, installs the actual tarball offline
into an isolated consumer, imports **every declared SDK subpath** in both ESM
and CommonJS, compares their runtime export names, and type-checks all public
declaration imports with strict ES2020-only libraries, no ambient platform types,
and `skipLibCheck: false`. It does not replace assertions with import stubs or
skip failing checks. The existing build remains a prerequisite; `pnpm test`
performed the clean rebuild in this phase.

The original guarded `finally` cleanup remains. A deliberately failing package
CLI regression confirms that the verifier exits unsuccessfully, retains both
output streams and the child exit status, and removes its temporary consumer.

On failure, diagnostics include the exact executable/argument array, working
directory, exit status, terminating signal, spawn error code/message, stdout,
and stderr. Missing executables report `ENOENT`; a controlled exit-7 regression
checks captured output/status rather than accepting any thrown error.

## Actual results

All local executions were on Windows. Available installed Node versions were
selected per process through PATH, without changing the system's selected Node
installation. The verifier reports its actual running Node version.

| Runtime | `pnpm verify:package` | Process regressions |
| --- | --- | --- |
| Node **22.23.2** | **PASS, exit 0**; 12 ESM/CJS entries, declarations, 299 files | **8/8 passed**, zero failures/skips/cancellations |
| Node **24.22.2** | **PASS, exit 0**; 12 ESM/CJS entries, declarations, 299 files | **8/8 passed**, zero failures/skips/cancellations |
| Node **26.13.0** | **PASS, exit 0**; 12 ESM/CJS entries, declarations, 299 files | **8/8 passed**, zero failures/skips/cancellations |

Additional results on Node 22.23.2:

- `npm run verify:package`: **PASS**, all packed import/declaration assertions.
- `pnpm verify:package` with the real installed `npm.cmd` override: **PASS**.
- The same command with the real installed `pnpm.cmd` override: **PASS**.
- `pnpm lint`: **PASS**, TypeScript and ESLint.
- `pnpm test`: **PASS**, clean warning-free ESM/CJS rebuild; **466 tests,
  466 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo**. Runtime duration
  1680.1132 ms. This includes the existing ML, workflow, security, licensing,
  model, memory and adapter regressions.
- `git diff --check`: **PASS** (Git separately notes CRLF conversion policy).

The process tests use paths containing spaces and `&`, verify that shell
metacharacters and quotes reach a JavaScript CLI literally, exercise native
dispatch, resolve both `.cmd` and `.bat` wrappers, reject unsupported launchers,
check child/spawn error details, and verify cleanup after pack failure.

The CI matrix covers Ubuntu and Windows on Node 22, 24 and 26, runs the same
tests and both npm/pnpm verification paths, and grants only read access to repo
contents. **CI is configured, not remotely executed in this phase.** Linux is
therefore not claimed as an observed local pass. Action configuration follows
the official [pnpm setup action](https://github.com/pnpm/action-setup) and
[Node setup action](https://github.com/actions/setup-node) usage.

## Remaining problems and boundary

The specific pnpm executable launch failure is resolved on all three reproduced
Node versions. Unsupported/custom batch layouts require an explicit supported
CLI override rather than a shell fallback. Only npm and pnpm are supported by
this verifier; other package-manager workflows are not inferred to be compatible.

This fix does not address the previously recorded Node16-mode CJS declaration
mapping limitation, lockfile policy, model-router defects, or test-loader
deprecation. Broader Stage 1 completion should use a new final regression result;
this focused phase does not rewrite the historical failed B04 report or claim
that CI has passed.

No npm publication or version change. Stopped after **B03-F1**.
