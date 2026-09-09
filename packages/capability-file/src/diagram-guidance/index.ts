import type { CapabilitySkill } from '@webpilot/capability-sdk';
import { diagramFoundation } from './foundation.ts';
import { diagramStructure } from './structure.ts';
import { diagramProcess } from './process.ts';
import { diagramTime } from './time.ts';
import { diagramData } from './data.ts';

/** References use the existing Skill read contract; no tool activation or extra gate. */
export const fileDiagramReferenceSkills: readonly CapabilitySkill[] = Object.freeze([
  { id: 'system-file-diagram-design', title: 'File diagrams: layout and Office mapping',
    description: 'Optional file reference for diagram layout, connectors, typography, native Office mapping and QA. Read only when authoring diagrams.', content: diagramFoundation },
  { id: 'system-file-diagram-structure', title: 'File diagrams: structure and relationships',
    description: 'Optional file reference for architecture, deployment, dependency, tree, organization, layers, ER/schema and class diagrams.', content: diagramStructure },
  { id: 'system-file-diagram-process', title: 'File diagrams: behavior and messages',
    description: 'Optional file reference for flowcharts, swimlanes, sequence, states, queues, feedback and policy traces.', content: diagramProcess },
  { id: 'system-file-diagram-time', title: 'File diagrams: time and plans',
    description: 'Optional file reference for timeline, Gantt, roadmap, user journey, story map and kanban layout.', content: diagramTime },
  { id: 'system-file-diagram-data', title: 'File diagrams: quantitative comparisons',
    description: 'Optional file reference for chart selection, truthful scales, flow quantities and native Office data figures.', content: diagramData },
].map(({ description, ...reference }) => Object.freeze({
  ...reference,
  summary: `<system_skill>\n<id>${reference.id}</id>\n<title>${reference.title}</title>\n<description>${description}</description>\n<required>false</required>\n</system_skill>`,
  required: false,
})));

export const fileDiagramReferenceRouting = `## Diagram design references (read only when needed)

For a diagram or a nontrivial data-figure composition, first identify what the reader must understand. Read system-file-diagram-design for shared layout and mapping to the planned Office engine, then only the relevant reference below. Use the existing skill tool with action=read and the exact skillId; these are supporting references in this file capability, not additional mandatory runtime Skills. Reuse a reference while its current content is available. Ordinary file reads/downloads, text writes, simple tables and unrelated edits need none of them.

${fileDiagramReferenceSkills.slice(1).map((skill) => `- ${skill.id}: ${skill.title.replace('File diagrams: ', '')}.`).join('\n')}

Use structure for architecture/deployment/dependencies/hierarchies/data models; process for flows/messages/states/feedback; time for timelines/schedules/journeys; data for quantitative comparisons and measured flows. If the task spans families, read only those sections that change the design. Adapt the rules to the user's content, brand, notation, target format and readability requirements. Fixed palettes, fonts, grid sizes and node counts are suggestions, not universal constraints. Do not discard required detail or flatten editable Office pages. API discovery, generation and visual QA continue through the existing file workflow; a reference does not implement a new chart type or converter.
`;
