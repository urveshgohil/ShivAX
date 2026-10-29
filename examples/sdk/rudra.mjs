// Actual bounded workflow with narrow in-memory changes and approval predicates.
import { createAutonomousDemo } from '../autonomous-workflow.mjs';
const demo = await createAutonomousDemo(request => request.input.resource === 'fixture:heading' && request.input.after === 24);
const result = await demo.run.result;
if (result.status !== 'completed') throw new Error(result.error.message);
console.log(result);
