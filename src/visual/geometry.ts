import type { BoundingRectangle } from './types.js';
import { validateBoundingRectangle } from './validation.js';

function pair(a: BoundingRectangle, b: BoundingRectangle): void {
    validateBoundingRectangle(a); validateBoundingRectangle(b);
}
/** Euclidean distance between rectangle centers, in CSS pixels. */
export function distance(a: BoundingRectangle, b: BoundingRectangle): number {
    pair(a, b);
    return Math.hypot(b.x + b.width / 2 - a.x - a.width / 2, b.y + b.height / 2 - a.y - a.height / 2);
}
/** Touching edges have no intersection area; two empty rectangles have IoU 0. */
export function overlap(a: BoundingRectangle, b: BoundingRectangle): {
    rectangle: BoundingRectangle | null; area: number; intersectionOverUnion: number;
} {
    pair(a, b);
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x);
    const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y);
    const area = width * height, union = a.width * a.height + b.width * b.height - area;
    return { rectangle: area ? { x, y, width, height } : null, area, intersectionOverUnion: union ? area / union : 0 };
}
/** Signed center displacement of b relative to a. Positive means right/down. */
export function relativePosition(a: BoundingRectangle, b: BoundingRectangle): { dx: number; dy: number } {
    pair(a, b);
    return { dx: b.x + b.width / 2 - a.x - a.width / 2, dy: b.y + b.height / 2 - a.y - a.height / 2 };
}
/** Directed edge gap: b.left - a.right. Negative means overlap or reverse order. */
export function horizontalGap(a: BoundingRectangle, b: BoundingRectangle): number {
    pair(a, b); return b.x - (a.x + a.width);
}
/** Directed edge gap: b.top - a.bottom. Negative means overlap or reverse order. */
export function verticalGap(a: BoundingRectangle, b: BoundingRectangle): number {
    pair(a, b); return b.y - (a.y + a.height);
}
export function contains(outer: BoundingRectangle, inner: BoundingRectangle): boolean {
    pair(outer, inner);
    return inner.x >= outer.x && inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}
/** Edge/center equality within an explicit nonnegative CSS-pixel tolerance. */
export function alignment(a: BoundingRectangle, b: BoundingRectangle, tolerance = 0): {
    left: boolean; right: boolean; top: boolean; bottom: boolean; centerX: boolean; centerY: boolean;
} {
    pair(a, b);
    if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError('Invalid alignment tolerance');
    const near = (x: number, y: number) => Math.abs(x - y) <= tolerance;
    return { left: near(a.x, b.x), right: near(a.x + a.width, b.x + b.width),
        top: near(a.y, b.y), bottom: near(a.y + a.height, b.y + b.height),
        centerX: near(a.x + a.width / 2, b.x + b.width / 2),
        centerY: near(a.y + a.height / 2, b.y + b.height / 2) };
}
