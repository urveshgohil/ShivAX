export const INPUT_SIZE = 28;
const REGION_SIZE = 20;

/** Intensity-weighted pixel coordinates, or null for a blank image. */
export function centerOfMass(pixels, width = INPUT_SIZE) {
    let mass = 0, x = 0, y = 0;
    for (let i = 0; i < pixels.length; i++) {
        mass += pixels[i]; x += (i % width) * pixels[i]; y += Math.floor(i / width) * pixels[i];
    }
    return mass ? { x: x / mass, y: y / mass, mass } : null;
}

/** Pure preprocessing: area-average resize followed by subpixel mass centering.
 * Input is row-major grayscale in [0,1]; input storage is never changed.
 * No thresholding of the output, dilation, or erosion: retain soft edges/holes.
 */
export function preprocessGrayscale(source, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1_048_576 || source.length !== width * height) {
        throw new RangeError('Invalid image dimensions');
    }
    let left = width, top = height, right = -1, bottom = -1;
    for (let i = 0; i < source.length; i++) {
        const value = source[i];
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Pixels must be finite values in [0, 1]');
        if (value > 1 / 255) {
            const x = i % width, y = Math.floor(i / width);
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
    }
    const blank = () => ({ blank: true, pixels: new Array(784).fill(0), bounds: null, center: null });
    if (right < 0) return blank();
    const bounds = { left, top, right, bottom };
    // Include a source pixel of padding so faint antialiased boundary pixels survive.
    left = Math.max(0, left - 1); top = Math.max(0, top - 1);
    right = Math.min(width - 1, right + 1); bottom = Math.min(height - 1, bottom + 1);
    const cropWidth = right - left + 1, cropHeight = bottom - top + 1;
    const scale = REGION_SIZE / Math.max(cropWidth, cropHeight);
    const offsetX = (INPUT_SIZE - cropWidth * scale) / 2;
    const offsetY = (INPUT_SIZE - cropHeight * scale) / 2;
    const resized = new Float64Array(784);
    // Integrate each target pixel's source footprint. Unlike point sampling this
    // retains narrow strokes when shrinking, independently of browser smoothing.
    for (let y = 0; y < INPUT_SIZE; y++) for (let x = 0; x < INPUT_SIZE; x++) {
        const x0 = Math.max(left, left + (x - offsetX) / scale);
        const x1 = Math.min(right + 1, left + (x + 1 - offsetX) / scale);
        const y0 = Math.max(top, top + (y - offsetY) / scale);
        const y1 = Math.min(bottom + 1, top + (y + 1 - offsetY) / scale);
        let sum = 0;
        for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
            const area = Math.max(0, Math.min(x1, sx + 1) - Math.max(x0, sx)) * Math.max(0, Math.min(y1, sy + 1) - Math.max(y0, sy));
            sum += source[sy * width + sx] * area;
        }
        resized[y * INPUT_SIZE + x] = Math.min(1, Math.max(0, sum * scale * scale));
    }
    const center = centerOfMass(resized);
    if (!center) return blank();
    let minX = 28, minY = 28, maxX = -1, maxY = -1;
    for (let i = 0; i < resized.length; i++) if (resized[i] > 0) {
        minX = Math.min(minX, i % 28); maxX = Math.max(maxX, i % 28);
        minY = Math.min(minY, Math.floor(i / 28)); maxY = Math.max(maxY, Math.floor(i / 28));
    }
    // Clamp only when necessary to retain every nonzero pixel instead of clipping.
    const dx = Math.max(-minX, Math.min(27 - maxX, 13.5 - center.x));
    const dy = Math.max(-minY, Math.min(27 - maxY, 13.5 - center.y));
    const shifted = new Float64Array(784);
    for (let i = 0; i < resized.length; i++) if (resized[i] > 0) {
        const x = i % 28 + dx, y = Math.floor(i / 28) + dy;
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) {
            const weight = (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy);
            if (weight && ix + ox >= 0 && ix + ox < 28 && iy + oy >= 0 && iy + oy < 28) {
                shifted[(iy + oy) * 28 + ix + ox] += resized[i] * weight;
            }
        }
    }
    // Quantize once so the 8-bit preview is exactly the array submitted to the worker.
    const pixels = Array.from(shifted, value => Math.round(Math.min(1, value) * 255) / 255);
    const finalCenter = centerOfMass(pixels);
    return finalCenter ? { blank: false, pixels, bounds, center: finalCenter } : blank();
}

/** Composite RGBA over black, preserving white-on-black luminance and alpha. */
export function preprocessImageData({ data, width, height }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1_048_576 || data.length !== width * height * 4) {
        throw new RangeError('Invalid RGBA image dimensions');
    }
    const gray = new Float64Array(width * height);
    for (let i = 0; i < gray.length; i++) {
        const offset = i * 4;
        for (let c = 0; c < 4; c++) if (!Number.isFinite(data[offset + c]) || data[offset + c] < 0 || data[offset + c] > 255) throw new RangeError('Invalid RGBA channel');
        gray[i] = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255 * (data[offset + 3] / 255);
    }
    return preprocessGrayscale(gray, width, height);
}
