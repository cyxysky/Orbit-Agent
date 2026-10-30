/** Adapted from Diagram Design; see ../../THIRD_PARTY_NOTICES.md. */
export const diagramProcess = `# Processes, messages, states and feedback

Use with system-file-diagram-design. Choose according to meaning: actions/decisions → flowchart; ownership handoffs → swimlane; time-ordered messages → sequence; events changing an object's state → state machine; reinforcing feedback → loop. A process stage and a state are not interchangeable labels.

## Flowchart and swimlane

Make start/end and branch conditions explicit where they are material. Give each outgoing decision branch a readable condition; do not rely on right/down placement or color to mean yes/no. Keep the dominant flow direction stable, route retries/returns visibly, and preserve error/termination paths requested by the user. A decision with many alternatives may need a labeled multiway split or a detail view, not invented binary logic.

In swimlanes, each lane denotes an actor/team/system, and each step belongs to its actual owner. Cross-lane edges are handoffs; name the transferred work/data where useful. Lane lengths and step counts need not match. A step spanning two lanes often hides unclear responsibility: split the collaboration into explicit actions when supported by the facts.

For repeated stage frameworks, align the same semantic slots (such as input, control and output) across stages. Distinguish not applicable from unknown/missing; empty space must not imply completion. Ownership lanes and semantic slot rows answer different questions.

## Sequence

Keep participants on stable lifelines and order messages along a single time axis. Message position conveys order, not measured duration unless a real time scale is supplied. Name request, response and asynchronous behavior with text/line conventions explained in the figure; derive those behaviors from evidence. Activation spans end when the corresponding execution ends.

Place alternatives, optional sections and repetitions inside labeled frames with explicit guards. Align messages and conditions so text does not collide with lifelines or activation bars. Isolate complicated exception paths into a related detail view when necessary. Frame operators and symbols must follow the requested notation; do not claim complete UML support from a visual resemblance.

## State machine

Name the state of a specific entity, then label each transition with the triggering event and, where relevant, guard and effect. Distinguish initial/final states from ordinary states, show self-transitions clearly, and keep exceptional paths readable. A shared any-state transition may be summarized only if its scope and exceptions are explicit. Do not infer that every state can transition to every other state or confuse internal processing steps with externally observable state.

## Queues and feedback

For a bottleneck, show arrivals, queued work, the constrained service, capacity with units when known, and admitted/deferred/rejected outcomes. Avoid a neat equal-width pipeline that hides waiting. Label unknown capacity as unknown instead of fabricating numbers.

For a feedback loop, label what returns and how it affects the next cycle; a ring of arrows alone does not establish reinforcement. Show memory/storage as a distinct shared object only when participants actually read/write it. Label reads and write-backs independently, and distinguish feedback from a simple retry or a one-time return.

When comparing policy traces, keep the same rule ordering, show the differing inputs and first meaningful divergence, and distinguish failed, skipped and not reached outcomes. A terminated path must not depict later work as executed. For transformation diagrams, connect representative source material to the resulting fields/artifact and preserve missing/uncertain values; a decorative AI box is not an explanation of the transformation.

## Focused checks

Walk a normal and an exceptional scenario through the figure. Check each branch label, handoff owner, return direction, guard and terminal state against the supplied behavior. All essential outcomes must remain readable in static PPTX/PDF output. Use native text/shapes/connectors where supported and preserve the existing file QA workflow.
`;
