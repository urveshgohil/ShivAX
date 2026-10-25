import type { Planner, PlanningContext, WorkflowPlan } from './types.js';

/** Deterministic default: dispatch the requested capability once, without inference. */
export class CapabilityPlanner implements Planner {
    plan(context: PlanningContext): WorkflowPlan {
        return {
            steps: [
                { id: 'step-1', capability: context.input.capability, input: { source: 'task' } },
            ],
        };
    }
}
