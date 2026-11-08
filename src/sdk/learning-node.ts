// Node.js-only entry (SARASWATI S03). Imports node:worker_threads; never import it from browser code.
export {
    WorkerTrainingPool,
    trainOfflineCandidateInWorker,
    trainCuratedCandidateInWorker,
    type WorkerTrainingPoolOptions,
    type WorkerTrainingRequest,
    type WorkerTrainingResult,
    type WorkerTrainingPoolStats,
    type WorkerTrainingCallOptions,
} from '../learning/worker-training.js';
export {
    WORKER_TRAINING_PROTOCOL,
    WORKER_TRAINING_LIMITS,
    WORKER_TRAINING_ERROR_CODES,
    WorkerTrainingError,
    type WorkerTrainingErrorCode,
    type WorkerTermination,
    type WorkerTrainOptions,
    type WorkerValidationSet,
    type WorkerTrainingProgress,
} from '../learning/worker-protocol.js';
