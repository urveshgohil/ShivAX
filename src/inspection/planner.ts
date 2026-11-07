import type { Planner, PlanningContext, WorkflowStep } from '../agents/rudra/types.js';
import { BotError } from '../agents/errors.js';
/** Fixed workflow only; no provider proposal may add tools or permissions. */
export class InspectionPlanner implements Planner {
    plan(context: PlanningContext) {
        const screenshot = context.input.capability === 'vision.inspection-reference';
        if (!screenshot && context.input.capability !== 'inspection.scan')
            throw new BotError('unsupported-capability');
        const steps: WorkflowStep[] = screenshot
            ? [
                  {
                      id: 'vision',
                      capability: 'vision.inspection-reference',
                      input: { source: 'task' },
                  },
              ]
            : [];
        steps.push(
            {
                id: 'capture',
                capability: 'inspection.scan',
                input: screenshot ? { source: 'step', stepId: 'vision' } : { source: 'task' },
            },
            {
                id: 'compare',
                capability: 'inspection.compare-captured',
                input: { source: 'step', stepId: 'capture' },
            },
            {
                id: 'review',
                capability: 'review.findings',
                input: { source: 'step', stepId: 'compare' },
            }
        );
        return { steps };
    }
}
export const INSPECTION_WORKFLOW_CAPABILITIES = Object.freeze([
    'vision.inspection-reference',
    'inspection.scan',
    'inspection.compare-captured',
    'review.findings',
]);
