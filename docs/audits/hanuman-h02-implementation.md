# SHIVAX 0.4.0 HANUMAN · H02-B implementation report

**17 November 2026 (Asia/Calcutta)** · Code baseline `0a813e4` · H02-A design `5f6e99a` · Package baseline `0.3.3`

**PASS for H02-B implementation and offline validation. H01 remains NO-GO for live deployment.**

The [H02-A schema](hanuman-h02-schema.md) records an H01 GO or owner-waiver
prerequisite. The latest user instruction explicitly requests H02-B
against the existing gateway. This report records that instruction as
authorization for the narrow specialist implementation and offline verification.
It does not establish a new H01 security verdict, waive live deployment
requirements, or claim that a reviewed host transport exists.

## Change plan and regression risks

Before editing, the bot operation, schema, registry, default system, SDK exports,
security leases, and H01 service were checked against the H02-A schema, H00
audit and H01-A through H01-D reports. The implementation adds one specialist
and derives network authority entirely from the existing H01 protected tool.
The main risks were unsupported capability advertisement, changes to the
default roster, a spoofed tool envelope, a split surrogate pair in the excerpt,
retrying a gateway denial, and ESM/CJS export or declaration regressions.

## Changed paths

| Path | Change |
| --- | --- |
| `src/bots/hanuman.ts` | Adds the specialist, versioned schemas, tool result validation, evidence construction and explicit registration. |
| `src/bots/index.ts` | Exposes the new API through existing root and `shivax/bots` re-exports. |
| `examples/sdk/hanuman.mjs` | Runs the registered specialist with an offline H01 mock transport, verified tool grant and approval. Demonstrates denial when registration or a grant is absent. |
| `examples/sdk/README.md`, `package.json` | Document and include the offline example in the packed files. |
| `tests/hanuman-bot.test.mjs` | Adds the ESM/CJS specialist regression suite with a global fetch tripwire. |
| `scripts/check-sdk-package.mjs` | Executes the example and new suite in the installed tarball and checks the public declarations. |
| `docs/sdk.md`, `SECURITY.md` | Document registration, scope, evidence and the live deployment gate. |
| `docs/audits/hanuman-h02-implementation.md` | Records implementation decisions and validation results. |

The existing H02-A schema was read and left as supplied.

## Public API and capability matrix

Runtime exports are `HanumanBot`, `registerHanumanBot`,
`HANUMAN_FETCH_URL_CAPABILITY` and `HANUMAN_RESERVED_CAPABILITIES`. Type
exports are `HanumanFetchUrlInput`, `HanumanEvidence`, `HanumanBotOptions`
and `RegisterHanumanBotOptions`. Input and evidence use structural type
aliases so typed values can be supplied as `BotValue`. The H01 integration
exports and IDs are unchanged.

| Bot or capability | Availability |
| --- | --- |
| `hanuman` | Explicit registration. Never included in the default seven bots. |
| `fetch.url` | The only advertised capability. Requires `shivax.hanuman.fetch` and the existing execution authorization. |
| `fetch.api` | Reserved. JSON targets already use the primary capability. |
| `research.search` | Reserved pending a protected search tool contract. |
| `hanuman.fetch` | Existing H01 capability ID for host workflow bindings. |

`registerHanumanBot(registry, { tools, ...options })` checks the supplied
registry and rejects a duplicate bot or unavailable H01 tool. It grants no
authority or permission. Direct construction is supported for host composition
and performs no availability check. Any registered instance still depends on
the runtime's exact task grant, Vijay policy and approval, and a matching
NARASIMHA binding. The factory still returns seven bots and 29 capabilities,
including the exact `vishwakarma` ID.

## Security boundaries and limitations

- The v1 schema accepts a host catalog target ID and an optional integer excerpt
  bound. Caller URL, search, header, method, timeout and identity or authority
  fields are outside the closed schema. Host execution budgets still apply.
- The only tool call sends `{ targetId }` to the leased H01 tool. The specialist
  rechecks envelope keys, target match, media type, status, UTF-8 byte count
  and untrusted classification. It accepts the H01 charset and control
  restrictions and rejects lone surrogates. It never interprets fetched text.
- Evidence supplies a registered-target reference, UTC receipt time, status,
  media type, full body byte count, excerpt and truncation flag. The digest uses
  Web Crypto SHA-256 over fixed lexicographic JSON keys `body`, `mediaType`,
  `scopeId`, `scopeKind`, `targetId`, `v`. It supports within-scope
  deduplication and conveys no authenticity. The runtime must supply Web Crypto.
- H01 keeps the source URL and origin in the host catalog. Evidence contains
  no credential fields, response headers, cookies or transport errors.
  An arbitrary external body may contain secret-like text. Host endpoints
  must be suitable for disclosure and downstream consumers must treat every
  excerpt as untrusted text. A truncated JSON excerpt may be invalid JSON.
- The bot path maps gateway denials to `tool-not-allowed`. The test verifies
  one request for a rejected redirect even with RUDRA retries enabled. H01D-01
  still applies to the separate host workflow path. An invalid injected clock
  is a host `bot-error`, which can be retryable under RUDRA's generic policy.
  The documented host example uses `maxRetries: 0`.
- H01D-02 remains open. Fixtures exercise the authorization and evidence
  contracts. They do not establish socket pinning, TLS verification or other
  live transport properties. H02-C adversarial testing remains separate.

## Actual validation

| Command | Result |
| --- | --- |
| `node --test tests/hanuman-bot.test.mjs tests/hanuman-fetch.test.mjs` | PASS, 188/188 (18 specialist and 170 gateway tests). |
| `node examples/sdk/hanuman.mjs` | PASS, untrusted evidence returned, missing registration and tool grant denied. |
| `pnpm lint` | PASS, exit 0. |
| `pnpm test` | PASS, 1085/1085 (1067 existing and 18 new). |
| `pnpm build` | PASS, exit 0. |
| `pnpm verify:package` | PASS, 18 specialist and 170 gateway tests against the installed tarball, 13 entry points, five declaration modes, 12 offline examples, 532 packed files. |

The focused and full suites reported zero failures, cancellations and skips.
The specialist suite covers stable IDs, registration and duplicate handling,
default exports, schema rejection, a full Jay/Vijay/NARASIMHA success path,
missing tool and permissions, untrusted text, malformed envelopes, surrogate
bounds and non-retryable gateway rejection. Tests and examples used mock
transports without live egress. Node was `22.23.2`. pnpm ran offline with
preinstalled dependencies and hoisted/copy settings for Windows package
verification. Command logs are in ignored `node_modules/h02b-*.log` files.

Work stopped after H02-B.
