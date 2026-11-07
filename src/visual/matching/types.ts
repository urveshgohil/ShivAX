import type { ElementRelationship } from '../types.js';

export type MatchingSignal = 'role' | 'content' | 'grouping' | 'structure' | 'parent' | 'siblings' | 'geometry' | 'relationships';
export interface MatchEvidence {
    signal: MatchingSignal;
    similarity: number;
    reliability: number;
    weight: number;
    detail: string;
}
export interface MatchCandidate {
    referenceId: string;
    targetId: string;
    /** Derived weighted evidence score, NOT a calibrated probability. */
    score: number;
    evidence: MatchEvidence[];
}
export interface ElementMatch extends MatchCandidate {
    confidence: { score: number; method: 'weighted-evidence-v1'; margin: number };
    level: 'region' | 'section' | 'group' | 'element';
}
export interface UncertainElement {
    referenceId: string;
    reason: 'ambiguous' | 'insufficient-evidence' | 'unmatched-parent';
    candidates: MatchCandidate[];
}
export interface UncertainTargetElement {
    targetId: string;
    reason: UncertainElement['reason'];
    candidates: MatchCandidate[];
}
export interface RelationshipMatch {
    reference: ElementRelationship;
    target: ElementRelationship;
    /** Correspondence is inferred through the accepted endpoint matches. */
    score: number;
    method: 'matched-endpoints-and-type';
}
export interface MatchingResult {
    matches: ElementMatch[];
    unmatchedReference: string[];
    unmatchedTarget: string[];
    uncertain: UncertainElement[];
    uncertainTarget: UncertainTargetElement[];
    ignoredReferenceWrappers: string[];
    ignoredTargetWrappers: string[];
    relationships: {
        matched: RelationshipMatch[];
        missing: ElementRelationship[];
        extra: ElementRelationship[];
        unresolvedReference: ElementRelationship[];
        unresolvedTarget: ElementRelationship[];
    };
    work: number;
}
export interface MatchingOptions {
    minScore?: number;
    ambiguityMargin?: number;
    /** Counts preprocessing, search passes and candidate evaluations; fail closed. */
    maxWork?: number;
}
