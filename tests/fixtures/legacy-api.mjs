// Public root contract before the bot foundation (audit baseline e47f462).
// New exports are allowed; these names must continue to resolve.
export const LEGACY_RUNTIME_EXPORTS = Object.freeze([
    'VERSION', 'Tensor', 'MAX_TENSOR_ELEMENTS', 'dot', 'sigmoid', 'softmax', 'seededRandom',
    'NeuralNet', 'classificationAccuracy', 'crossEntropy', 'evaluateClassification',
    'evaluateRegression', 'BagOfWords', 'MAX_UI_NODES', 'validateUISnapshot',
    'validateBoundingRectangle', 'validateComparisonOptions', 'normalizeUISnapshot',
    'validateConfidence', 'validateSourceProvenance', 'validateUINode',
    'validateTypographyProperties', 'validateLayoutProperties', 'validateElementRelationship',
    'distance', 'overlap', 'alignment', 'relativePosition', 'verticalGap', 'horizontalGap',
    'contains', 'matchUISnapshots', 'analyzeUI', 'validateUIAnalysisOptions', 'SLMClient',
    'SLMError', 'OllamaProvider', 'analyzeUIWithSLM',
]);

export const LEGACY_TYPE_EXPORTS = Object.freeze([
    'Vector', 'Matrix', 'Label', 'ModelConfig', 'NeuralNetOptions', 'TrainOptions',
    'TrainingResult', 'Task', 'Initialization', 'SerializedNeuralNet', 'Activation',
    'OptimizerName', 'OptimizerOptions', 'OptimizerConfig', 'ClassMetrics',
    'ClassificationMetrics', 'RegressionMetrics', 'UISnapshot', 'UINode',
    'BoundingRectangle', 'TypographyProperties', 'LayoutProperties', 'ElementRelationship',
    'SourceProvenance', 'Confidence', 'ComparisonOptions', 'Measurement', 'SourceType',
    'RGBAColor', 'MatchingOptions', 'MatchingResult', 'MatchEvidence', 'MatchingSignal',
    'MatchCandidate', 'ElementMatch', 'UncertainElement', 'UncertainTargetElement',
    'RelationshipMatch', 'ContentPolicy', 'UITolerances', 'UIAnalysisOptions', 'UIIssueCategory',
    'UIIssueValue', 'UIIssueDifference', 'UISupportingMeasurement', 'UISuppressedIssue',
    'UIIssue', 'UIAnalysisDiagnostic', 'UIAnalysisResult', 'SLMProvider', 'SLMLimits',
    'SLMRequest', 'SLMClientOptions', 'SLMResult', 'SLMErrorCode', 'SLMScope', 'SLMSignal',
    'OllamaProviderOptions', 'SLMFetch', 'SLMFetchOptions', 'SLMFetchResponse', 'SLMUITask',
    'SLMUIOptions', 'SLMAdviceProvenance', 'SLMIssueAdvice', 'SLMUIResult',
]);
