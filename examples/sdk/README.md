# ShivAX SDK examples

These examples ship in the `shivax` npm package. They import public entry points
such as `shivax/core` and `shivax/security`. Node finds those imports in the
installed package through package self-reference. You need Node.js 22 or later.

From an application that has `shivax` installed:

```sh
node node_modules/shivax/examples/sdk/registry.mjs
```

From a checkout of the source repository, run `pnpm build` first. Then run
`node examples/sdk/<name>.mjs`.

| File | Needs | What it does |
| --- | --- | --- |
| `registry.mjs` | Nothing | Registers the seven specialist bots and lists their IDs. |
| `local-model.mjs` | Nothing | Trains a small CPU regression network, then serves it through `ModelRouter`. |
| `rudra.mjs` | Nothing | Runs a short RUDRA workflow on in-memory test data, with an approval check written in code. Uses `../autonomous-workflow.mjs`. |
| `memory-persistence.mjs` | A temp folder you can write to | Saves a memory record to a file in a new temp folder, opens it again, then deletes the folder. |
| `firewall.mjs` | Nothing | Creates a firewall with one CPU operation. It shows a request being denied by default, then an approved lockdown. Uses a mock identity labelled as a demo. |
| `ollama.mjs` | A local Ollama server with a model installed | Set `SHIVAX_OLLAMA_MODEL` to the model name. Without it, the script exits and tells you how to set it up. |
| `inspectra.mjs` | Your own browser setup | A module, not a script. It exports `connectInspectra(tools, openPage, authorizeURL)`, which connects the optional Inspectra adapter to the pages and URL rules your host supplies. Live capture also needs the optional peer `inspectra-engine@1.0.4`. |

The mock identities, approval callbacks and test data in these files are for
local demos only. In production, your host must check real sessions on a trusted
server or desktop process and ask a person to approve actions. Keep firewall
admin and root contexts out of bot, tool and browser code. See
`docs/production.md` in this package.

No React example ships with ShivAX, and React is not a dependency.
