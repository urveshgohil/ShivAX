/** Maximum allocation per tensor (4 MiB of Float32 data). */
export const MAX_TENSOR_ELEMENTS = 1_048_576;

function shapeSize(shape: readonly number[]): number {
    integer(shape.length, 1, 8, 'rank');
    let size = 1;
    for (const dimension of shape) {
        integer(dimension, 1, MAX_TENSOR_ELEMENTS, 'dimension');
        size *= dimension;
        if (size > MAX_TENSOR_ELEMENTS) throw new RangeError('Tensor allocation limit exceeded');
    }
    return size;
}

export function finite(value: number, name = 'value'): number {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
    return value;
}

export function integer(value: number, min: number, max: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
    }
    return value;
}

/** Dense, row-major CPU tensor. Inputs and returned data are defensive copies. */
export class Tensor {
    readonly shape: readonly number[];
    readonly size: number;
    private readonly values: Float32Array;

    constructor(data: ArrayLike<number>, shape: readonly number[]) {
        const size = shapeSize(shape);
        if (data.length !== size) throw new RangeError('Data length must match shape');
        this.shape = Object.freeze([...shape]);
        this.size = size;
        this.values = new Float32Array(size);
        for (let i = 0; i < size; i++) {
            this.values[i] = finite(data[i]);
            finite(this.values[i], 'Float32 value');
        }
    }

    static zeros(shape: readonly number[]): Tensor {
        return new Tensor(new Float32Array(shapeSize(shape)), shape);
    }

    get data(): Float32Array { return this.values.slice(); }

    get(...indices: number[]): number {
        if (indices.length !== this.shape.length) throw new RangeError('Index rank mismatch');
        let offset = 0;
        for (let i = 0; i < indices.length; i++) {
            integer(indices[i], 0, this.shape[i] - 1, 'index');
            offset = offset * this.shape[i] + indices[i];
        }
        return this.values[offset];
    }

    reshape(shape: readonly number[]): Tensor { return new Tensor(this.values, shape); }

    private elementwise(other: Tensor | number, op: (a: number, b: number) => number): Tensor {
        if (typeof other === 'number') finite(other);
        else if (this.shape.length !== other.shape.length || this.shape.some((n, i) => n !== other.shape[i])) {
            throw new RangeError('Element-wise operations require identical shapes');
        }
        const result = new Float32Array(this.size);
        for (let i = 0; i < this.size; i++) {
            result[i] = op(this.values[i], typeof other === 'number' ? other : other.values[i]);
        }
        return new Tensor(result, this.shape);
    }

    add(other: Tensor | number): Tensor { return this.elementwise(other, (a, b) => a + b); }
    subtract(other: Tensor | number): Tensor { return this.elementwise(other, (a, b) => a - b); }
    multiply(other: Tensor | number): Tensor { return this.elementwise(other, (a, b) => a * b); }

    transpose(): Tensor {
        if (this.shape.length !== 2) throw new RangeError('transpose requires rank 2');
        const [rows, columns] = this.shape;
        const result = new Float32Array(this.size);
        for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
            result[c * rows + r] = this.values[r * columns + c];
        }
        return new Tensor(result, [columns, rows]);
    }

    matmul(other: Tensor): Tensor {
        if (this.shape.length !== 2 || other.shape.length !== 2 || this.shape[1] !== other.shape[0]) {
            throw new RangeError('matmul requires compatible rank-2 tensors');
        }
        const [rows, inner] = this.shape;
        const columns = other.shape[1];
        if (rows * columns > MAX_TENSOR_ELEMENTS || rows * inner * columns > 50_000_000) {
            throw new RangeError('Matrix multiplication work limit exceeded');
        }
        const result = new Float32Array(rows * columns);
        for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
            let sum = 0;
            for (let k = 0; k < inner; k++) sum += this.values[r * inner + k] * other.values[k * columns + c];
            result[r * columns + c] = sum;
        }
        return new Tensor(result, [rows, columns]);
    }

    sum(): number { return this.values.reduce((sum, value) => sum + value, 0); }
    mean(): number { return this.sum() / this.size; }
}
