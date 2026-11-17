import { record } from '../../agents/validation.js';
import type { HanumanAddress } from './types.js';
import { HanumanFetchError } from './error.js';

/** Conservative reported-address check. Socket pinning remains a host obligation. */
export function publicAddress(raw: unknown): Readonly<HanumanAddress> {
    try {
        const item = record(raw, ['family', 'address'], 'invalid-input');
        const address = item.address;
        if (typeof address !== 'string' || address.length > 45) throw 0;
        if (item.family === 4) {
            if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(address)) throw 0;
            const [a, b, c, d] = address.split('.').map(Number);
            if (
                [a, b, c, d].some((part) => part > 255) ||
                a === 0 ||
                a === 10 ||
                a === 127 ||
                a >= 224 ||
                (a === 100 && b >= 64 && b <= 127) ||
                (a === 169 && b === 254) ||
                (a === 172 && b >= 16 && b <= 31) ||
                (a === 192 &&
                    (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
                (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
                (a === 203 && b === 0 && c === 113) ||
                address === '168.63.129.16'
            )
                throw 0;
        } else if (item.family === 6) {
            if (!/^[0-9a-f:]+$/.test(address)) throw 0;
            const canonical = new URL(`https://[${address}]/`).hostname.slice(1, -1);
            if (canonical !== address) throw 0;
            const parts = address.split('::');
            const left = parts[0] ? parts[0].split(':') : [];
            const right = parts[1] ? parts[1].split(':') : [];
            const words =
                parts.length === 1
                    ? left
                    : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
            const [first, second] = words.map((word) => parseInt(word, 16));
            // Transition and mapped forms are denied outright, including NAT64.
            if (
                first < 0x2000 ||
                first > 0x3fff ||
                first === 0x2002 ||
                (first === 0x2001 && (second < 0x200 || second === 0xdb8))
            )
                throw 0;
        } else throw 0;
        return Object.freeze({ family: item.family, address }) as HanumanAddress;
    } catch {
        throw new HanumanFetchError('address-denied');
    }
}
