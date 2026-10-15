export type SourceType = 'url' | 'figma' | 'png';

/** A quality annotation, not a calibrated probability. Unknown quality is null. */
export interface Confidence { score: number | null }
export interface SourceProvenance {
    sourceType: SourceType;
    kind: 'computed' | 'design' | 'estimated' | 'unknown';
    method: string;
    /** Opaque local identifier; never fetched or executed by Shivax. */
    reference?: string;
}
export type Measurement<T> = {
    status: 'known'; value: T; provenance: SourceProvenance; confidence: Confidence;
} | {
    status: 'unknown'; provenance: SourceProvenance; confidence: Confidence;
};

export interface BoundingRectangle { x: number; y: number; width: number; height: number }
export interface TypographyProperties {
    fontFamily?: Measurement<string>;
    fontSize?: Measurement<number>;
    fontWeight?: Measurement<number>;
    /** Explicit numeric length; unresolved CSS "normal" must remain unknown. */
    lineHeight?: Measurement<number>;
    letterSpacing?: Measurement<number>;
    wordSpacing?: Measurement<number>;
}
export interface LayoutProperties {
    display?: Measurement<string>;
    paddingTop?: Measurement<number>;
    paddingRight?: Measurement<number>;
    paddingBottom?: Measurement<number>;
    paddingLeft?: Measurement<number>;
    marginTop?: Measurement<number>;
    marginRight?: Measurement<number>;
    marginBottom?: Measurement<number>;
    marginLeft?: Measurement<number>;
    rowGap?: Measurement<number>;
    columnGap?: Measurement<number>;
}
export interface UINode {
    id: string;
    role?: string;
    text?: string;
    bounds: Measurement<BoundingRectangle>;
    typography?: TypographyProperties;
    layout?: LayoutProperties;
}
export interface ElementRelationship {
    from: string;
    to: string;
    type: 'parent-child' | 'contains' | 'labelled-by';
    provenance: SourceProvenance;
    confidence: Confidence;
}
export interface UISnapshot {
    version: 1;
    sourceType: SourceType;
    /** Explicit namespace metadata; no persistence or cross-snapshot merging occurs. */
    scope: { kind: 'company' | 'personal'; id: string };
    viewport: { width: number; height: number; devicePixelRatio: number };
    coordinates: {
        unit: 'css-px' | 'design-unit' | 'image-px';
        /** Divide all geometric lengths by this value; never infer it from DPR. */
        unitsPerCssPixel: number;
        /** All nodes use the same origin. No implicit scrolling/frame offset. */
        origin: 'viewport' | 'document' | 'artboard';
        /** Conversion audit trail, retained after normalization (not reapplied). */
        original?: { unit: 'design-unit' | 'image-px'; unitsPerCssPixel: number };
    };
    nodes: readonly UINode[];
    relationships: readonly ElementRelationship[];
}
/** Configuration only: this phase does not perform matching or comparison. */
export interface ComparisonOptions {
    geometryToleranceCssPx?: number;
    minConfidence?: number;
    compareTypography?: boolean;
    compareLayout?: boolean;
}
