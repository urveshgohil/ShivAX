import { money } from './validation.js';

// Every finite USD number's shortest decimal representation fits this scale,
// including Number.MIN_VALUE (5e-324). Bounded inputs need only ~1100-bit integers.
// Interpret the public decimal value, not its binary floating-point expansion.
const DECIMALS = 324;
export function costUnits(value: number): bigint {
    money(value);
    const [coefficient, exponent = '0'] = value.toString().split('e');
    const [whole, fraction = ''] = coefficient.split('.');
    return BigInt(whole + fraction) * 10n ** BigInt(DECIMALS + Number(exponent) - fraction.length);
}

/** Presentation only: admission and reconciliation never use floating-point sums. */
export function costUSD(units: bigint): number {
    return Number(units.toString() + 'e-' + DECIMALS);
}

/** Fund the smallest public Number cap that covers the exact priced attempt. */
export function reservationUSD(units: bigint): number {
    const value = costUSD(units);
    if (costUnits(value) >= units) return value;
    // Positive finite value, bounded by a previously validated USD budget.
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, value);
    bits.setBigUint64(0, bits.getBigUint64(0) + 1n);
    return bits.getFloat64(0);
}
