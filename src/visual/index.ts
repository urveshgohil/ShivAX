export type {
    UISnapshot, UINode, BoundingRectangle, TypographyProperties, LayoutProperties,
    ElementRelationship, SourceProvenance, Confidence, ComparisonOptions, Measurement, SourceType, RGBAColor,
} from './types.js';
export { MAX_UI_NODES, validateUISnapshot, validateBoundingRectangle,
    validateComparisonOptions, normalizeUISnapshot, validateConfidence, validateSourceProvenance,
    validateUINode, validateTypographyProperties, validateLayoutProperties, validateElementRelationship } from './validation.js';
export { distance, overlap, alignment, relativePosition, verticalGap, horizontalGap, contains } from './geometry.js';
export * from './matching/index.js';
export * from './analysis/index.js';
