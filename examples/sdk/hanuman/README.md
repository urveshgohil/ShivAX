# Offline Hanuman examples

Run these with Node 22 or newer, after installing SHIVAX or building this repository. The full guide, with purpose, permissions, origins, limits, expected output and limitations for each script, is in "Portable Hanuman examples (H06)" in `docs/sdk.md`.

```sh
node examples/sdk/hanuman/documentation.mjs
node examples/sdk/hanuman/rest.mjs
node examples/sdk/hanuman/workflow.mjs
node examples/sdk/hanuman/denials.mjs
```

From an installed package, prefix each path with `node_modules/shivax/`. The scripts import only `shivax/bots`, `shivax/integrations`, `shivax/rudra`, `shivax/security` and `node:assert/strict`. They need no network, model provider, Inspectra or Visynq.

The shared host supplies a fixed identity: `demo-user`, issuer `demo-host`, company scope `demo-tenant`. The mock identity provider is the authorization source. Explicit policies require evidence and network permissions, a tool grant and host approval.

The firewall admin setup in `host.mjs` is for fixtures only. `authorizeAdmin` always returns `true`, admin approval is automatic, and the demo user holds the admin permission in every mode, not just the lockdown case. Only `denials.mjs` calls the admin API. Do not copy this into a host. Use a separate administrator role, human approval and a context that bots never see.

The catalog contains one GET target: `https://docs.example.test/sdk`, or `https://api.example.test/v1/status` for REST. The REST target keeps the ID `demo-docs`. The transport returns in-memory bytes and reports a fixed peer address without opening DNS, sockets or TLS. The limits are:

- request input: 4 KiB (firewall);
- response body: 512 bytes (gateway);
- output: 8 KiB;
- service deadline: 200 ms;
- concurrency: at most three protected operations;
- model spending: zero.

No model provider is used.

Documentation prints validated evidence with a bounded excerpt, target reference, receipt timestamp and untrusted provenance. REST uses the supported `fetch.url` operation. It parses a complete JSON excerpt, checks the closed `{status: 'ok', version: 1}` schema with `assert`, and prints only approved fields plus source and trust. `fetch.api` remains reserved.

The workflow uses a fixed two-step RUDRA plan. It retrieves documentation twice and validates both evidence records before a deterministic host summary. The injection sentence stays as data. The plan and tool arguments are host-owned. The script prints source references and safe step/request counts. This shows generic RUDRA routing with explicit capability options. The H03 integration review's open findings still apply.

The denial example prints sanitized status and error codes. The following produce zero request callbacks:

- unapproved origins;
- missing tools;
- missing capability permissions;
- expired sessions;
- lockdown;
- timeout;
- cancellation.

An oversized response is rejected by the declared content-length check and closed once, with zero output records. Gateway failures show in the public RUDRA trace as the generic `tool-not-allowed`, then `bot-failed`, whatever the real cause. A host that needs the real code passes an `observe` callback to `registerHanumanFetchService`.

`host.mjs` is a mock transport for these examples. A fake callback cannot show socket pinning, DNS-rebinding resistance, TLS validation or SSRF safety. A real host transport still needs independent review against host obligations R-H1 to R-H8 in `docs/sdk.md`.

SHIVAX has no native public-web search. `research.search` is reserved and unsupported, and no search provider is installed or demonstrated. The H05 utilities are also absent from the current SDK.

`pnpm verify:package` installs a packed tarball into an external temporary consumer and runs all four examples and their 13 tests from the shipped package. The consumer verifies that Inspectra and Visynq are absent.
