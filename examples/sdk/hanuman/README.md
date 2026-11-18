# Offline Hanuman examples

Run with Node 22 or newer after installing SHIVAX or building this repository.

```sh
node examples/sdk/hanuman/documentation.mjs
node examples/sdk/hanuman/rest.mjs
node examples/sdk/hanuman/workflow.mjs
node examples/sdk/hanuman/denials.mjs
```

The shared host supplies a deterministic identity for `demo-user`, issuer `demo-host`, company scope `demo-tenant`. The mock identity provider is the authorization source. Explicit policies require evidence and network permissions, a tool grant, and host approval. A separate host administration policy authorizes only the example's lockdown setup.

The catalog contains one GET target at `https://docs.example.test/sdk`, or `https://api.example.test/v1/status` for REST. The transport returns in-memory bytes. Request input is limited to 4 KiB by the firewall, response bodies to 512 bytes by the gateway, and output to 8 KiB. The service deadline is 200 ms, with at most three concurrent protected operations and a zero model spending budget. Examples use no model provider.

Documentation prints validated evidence with a bounded excerpt, target reference, receipt timestamp and untrusted provenance. REST uses the supported `fetch.url` operation, parses a complete JSON excerpt, validates the closed `{status: 'ok', version: 1}` schema and prints only approved fields plus source and trust. `fetch.api` remains reserved.

The workflow uses a fixed two-step RUDRA plan. It retrieves documentation twice and validates both evidence records before a deterministic host summary. The injection sentence is retained as data. The fixed plan and tool arguments are host-owned. It prints source references and safe step/request counts. This demonstrates generic RUDRA routing with explicit capability options. The H03 integration review's open findings still apply.

The denial example prints sanitized status/error codes. Unapproved origins, missing tools, missing capability permissions, expired sessions, lockdown, timeout and cancellation produce zero request callbacks. An oversized response is rejected by the declared content-length check and closed once, with zero output records.

H06-A supplied an audit without new fixtures. `host.mjs` therefore reuses and extracts the existing public-SDK Hanuman example composition. It is a mock transport for these examples. A real host transport still requires independent DNS/socket/TLS security validation.

`research.search` is reserved and unsupported by Hanuman. A search demonstration is omitted under the task's conditional search requirement. No host search provider is installed by these examples. H05 utilities are also absent from the current SDK.

`pnpm verify:package` installs a packed tarball into an external temporary consumer and executes all four examples from the shipped package. The consumer verifies that Inspectra and Visynq are absent.
