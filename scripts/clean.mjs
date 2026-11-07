import { rmSync } from 'node:fs';

// Fixed generated-output directory, independent of the caller's working directory.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
