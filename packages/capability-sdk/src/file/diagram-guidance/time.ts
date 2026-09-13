/** Adapted from Diagram Design; see ../../THIRD_PARTY_NOTICES.md. */
export const diagramTime = `# Time, schedules and journeys

Use with system-file-diagram-design. Use a timeline for dated events, Gantt for task intervals/overlap, a roadmap for stages or intended horizons, and a user journey for actions and experiences across stages. A kanban board groups work by status; its columns are not a time scale.

## Timeline

Choose date bounds and units from the data. If position encodes elapsed time, place events proportionally to their dates. If only order is known or an equally spaced editorial timeline is requested, explicitly label the axis as sequence/not to scale. Mark any axis break. Stagger labels into clear tracks while keeping their attachment to the correct event unambiguous. Emphasize consequential milestones through text/weight as well as color.

## Gantt and roadmap

Reserve a real label column, date-axis area and enough row height before drawing bars. Derive each task's start and width from the same time mapping; show milestones distinctly from durations. Group tasks by a meaningful phase or owner without implying that the group itself is a task. Include dates, dependencies, progress or critical-path claims only when supplied or correctly calculated. State the progress basis if percent completion is shown.

Do not present an aspirational roadmap as a committed schedule. Unknown dates remain unspecified. Preserve actual overlaps, weekends/calendar conventions and time zones when relevant. When there are many tasks, provide a phase overview plus readable task detail instead of inventing aggregation dates or hiding blocking dependencies. Repeated labels may live outside short bars rather than be shrunk into them.

## Journeys, story maps and kanban

Keep stage ordering stable across action, touchpoint, evidence and pain-point rows. Attribute experience/sentiment to actual research, or label it as a hypothesis; do not manufacture numeric satisfaction scores. Story-map release slices must distinguish what ships together from the sequence in which a user acts. Kanban columns must name actual states, preserve blocked status and show WIP limits only if defined. Equal visual column widths do not imply equal capacity or duration.

## Output and checks

Use native Office charts when their semantics match the interval data; otherwise construct editable bars, milestones, labels and connectors with the planned engine. Keep document tables/cells native when they communicate the schedule better. Check axis units, date bounds, interval widths, overlapping labels, milestones and source/task completeness in the final render. A static PDF must contain the needed dates and explanations without relying on hover tooltips.
`;
