# SHIVAX SDK examples

These examples ship in the `shivax` npm package. They import public entry points
such as `shivax/core` and `shivax/security`, so they resolve against the installed
package through Node's package self-reference. They need Node.js 22 or later.

From an application that has installed `shivax`:

```sh
node node_modules/shivax/examples/sdk/registry.mjs
```

From a checkout of the source repository, run `pnpm build` first and then
`node examples/sdk/<name>.mjs`.

| File | Needs | What it does |
| --- | --- | --- |
| `registry.mjs` | Nothing | Registers the seven specialist bots and lists their IDs. |
| `local-model.mjs` | Nothing | Trains a small CPU regression network, then serves it through `ModelRouter`. |
| `rudra.mjs` | Nothing | Runs a bounded RUDRA workflow over an in-memory fixture with an explicit approval predicate. Uses `../autonomous-workflow.mjs`. |
| `memory-persistence.mjs` | Writable OS temp directory | Saves a memory record to a file in a new temporary directory, reopens it, then deletes the directory. |
| `firewall.mjs` | Nothing | Creates a managed firewall with one CPU registration, shows a default-deny result, then applies an approved lockdown. Uses a labelled mock identity. |
| `ollama.mjs` | A local Ollama server and an installed model | Set `SHIVAX_OLLAMA_MODEL` to that model name. Without it, the script exits with setup guidance. |
| `inspectra.mjs` | Host browser integration | A module, not a script. Exports `connectInspectra(tools, openPage, authorizeURL)`, which wires the optional Inspectra adapter to host-supplied page leases and URL policy. Live capture also needs the optional `inspectra-engine@1.0.4` peer. |

The mock identities, approval callbacks and fixtures in these files are for local
demonstration only. A production host must authenticate real sessions on a trusted
server or desktop process, ask a person for approvals, and keep firewall
administration and root contexts out of bot, tool and browser code. See
`docs/production.md` in this package.

No React example ships with SHIVAX, and React is not a dependency.
