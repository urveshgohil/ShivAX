import { createHost, evidenceFrom } from './host.mjs';

const host = createHost();
const evidence = evidenceFrom(host, await host.run());
console.log(JSON.stringify(evidence));
