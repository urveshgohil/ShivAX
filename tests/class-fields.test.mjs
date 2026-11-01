import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as esm from 'shivax/core';

const require = createRequire(import.meta.url);
for (const [format, { Tensor }] of [['ESM', esm], ['CJS', require('shivax/core')]]) {
    test(`${format}: Tensor subclasses retain inherited setter initialization semantics`, () => {
        let assignments = 0;
        class ObservedTensor extends Tensor {}
        // ES2020 constructor assignments invoked inherited setters. An implicit
        // switch to define semantics at ES2022 would silently bypass this hook.
        Object.defineProperty(ObservedTensor.prototype, 'shape', {
            set(value) {
                assignments++;
                Object.defineProperty(this, 'shape', {
                    value, enumerable: true, writable: true, configurable: true,
                });
            },
        });
        const tensor = new ObservedTensor([1, 2, 3, 4], [2, 2]);
        assert.equal(assignments, 1);
        assert.deepEqual(tensor.shape, [2, 2]);
        assert.equal(tensor.get(1, 0), 3);
        assert.deepEqual([...tensor.matmul(tensor).data], [7, 10, 15, 22]);
    });
}
