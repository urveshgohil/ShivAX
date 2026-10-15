import type { BoundingRectangle, ComparisonOptions, Measurement, RGBAColor } from '../types.js';
import type { MatchingOptions, MatchingResult } from '../matching/types.js';

export type ContentPolicy = 'structural' | 'strict' | 'selective';
export interface UITolerances {
    fontSize?: number;
    fontWeight?: number;
    lineHeight?: number;
    letterSpacing?: number;
    wordSpacing?: number;
    colorChannel?: number;
    colorAlpha?: number;
    dimensions?: number;
    position?: number;
    spacing?: number;
    alignment?: number;
}
export interface UIAnalysisOptions extends ComparisonOptions {
    contentPolicy?: ContentPolicy;
    /** Baseline node IDs whose text must match under the selective policy. */
    selectedNodeIds?: readonly string[];
    tolerances?: UITolerances;
    matchingOptions?: MatchingOptions;
    maxWork?: number;
}
export type UIIssueCategory = 'typography' | 'color' | 'alignment' | 'dimensions' | 'position' |
    'spacing' | 'relationship' | 'content' | 'structure' | 'order';
export type UIIssueValue = number | string | boolean | null | RGBAColor | BoundingRectangle | readonly string[] | readonly number[];
export type UIIssueDifference = { delta: number; absolute: number } | { changed: true } |
    { channels: RGBAColor };
export interface UISupportingMeasurement {
    side: 'baseline' | 'target';
    nodeIds: string[];
    property: string;
    measurement: Measurement<UIIssueValue>;
    /** Arithmetic on supplied values, or an explicit rule for derived evidence. */
    derivation?: string;
}
export interface UISuppressedIssue {
    id: string;
    baselineNodeId: string | null;
    targetNodeId: string | null;
    property: string;
    reason: string;
}
export interface UIIssue {
    id: string;
    category: UIIssueCategory;
    severity: 'low' | 'medium' | 'high';
    baselineNodeId: string | null;
    targetNodeId: string | null;
    relatedBaselineNodeIds: string[];
    relatedTargetNodeIds: string[];
    property: string;
    expected: UIIssueValue;
    actual: UIIssueValue;
    difference: UIIssueDifference;
    supportingMeasurements: UISupportingMeasurement[];
    targetCoordinates: Measurement<BoundingRectangle>;
    /** For a missing node, coordinates identify its matched container. */
    coordinateNodeId: string | null;
    suggestedCorrection: { action: string; property: string; value: UIIssueValue; automatic: false };
    confidence: { score: number; method: 'minimum-evidence-quality' };
    provenance: { kind: 'inferred'; method: 'deterministic-ui-analysis-v1' };
    reviewStatus: 'unreviewed' | 'needs-review';
    suppressedIssues: UISuppressedIssue[];
}
export interface UIAnalysisDiagnostic {
    code: 'unknown-measurement' | 'coordinate-context' | 'viewport-mismatch' | 'uncertain-match' | 'below-confidence';
    baselineNodeId: string | null;
    targetNodeId: string | null;
    property: string;
    message: string;
}
export interface UIAnalysisResult {
    issues: UIIssue[];
    matching: MatchingResult;
    diagnostics: UIAnalysisDiagnostic[];
    contentPolicy: ContentPolicy;
    work: number;
}
