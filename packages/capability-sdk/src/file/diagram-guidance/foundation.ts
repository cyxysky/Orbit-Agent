/** Adapted design guidance; attribution and MIT license: ../../THIRD_PARTY_NOTICES.md. */
export const diagramFoundation = `# Diagram design for file artifacts

Use this reference when a document needs a diagram to explain relationships or behavior. A paragraph or table is often better for a list or a simple comparison. These are authoring decisions, not new renderer features or additional execution gates.

## Establish meaning before geometry

Write down the reader's question, the entities involved, and what each connection means. Separate facts, assumptions, unknowns and proposed changes. Choose one primary visual grammar: structure, process, messages, state, time or quantity. A sequence of boxes alone does not explain a bottleneck, permission boundary or feedback loop; name that behavior explicitly.

Keep the requested content. When the figure is too dense, produce a labeled overview with linked detail, wrap labels, change orientation or allocate more page area. Merge only equivalent items and show their count; record substantive merges/omissions in a caption, notes or the accompanying explanation. Do not remove requirements to meet a node-count target. Around 6–9 primary items is a useful starting point for a slide overview, never a limit on a schema or a required inventory.

## Typography, color and space

Inherit the document's brand/template and font-size requirements. Define shared roles for background, primary text, secondary text, boundaries, focal emphasis and data series. A small number of emphasized elements often clarifies a schematic; consistent category/series colors may legitimately repeat across many marks. Labels, symbols or line styles must also carry status meaning.

Choose a readable body font with the required script coverage. Monospace can distinguish literal code/ports/IDs, but is not a default for all text. Chinese and other full-width labels need actual width allowance and font verification after rendering; do not estimate them as narrow Latin characters. Measure/wrap the longest real label before copying the node layout. Reserve space for labels, legends and captions independently of the shapes.

Use a coherent spacing rhythm; source facts and text fit take priority over snapping every coordinate to a grid. Decorative shadows, rounded cards, headers and rules are optional style choices, not a required shell. Preserve distinct visual roles and align comparable objects; do not force unrelated content into identical boxes.

## Connections and layers

Allocate node bounds and routing corridors before drawing. For schematic relationships, prefer short horizontal/vertical routes with restrained bends. Natural curves, diagonals or buses are appropriate when the selected grammar needs them, such as cycles, state transitions or a clearly shared tree trunk.

- End each connector at the intended node edge/port; use a native arrowhead, not a detached triangle.
- Give independent connections distinct ports and tracks. Do not let lines coincide in a way that implies an unintended merge. A shared bus is valid only when its common meaning is explicit.
- Keep routes out of unrelated nodes and keep labels clear of strokes and box boundaries. Reorder/reflow first; a supported bridge or an annotated crossover can resolve a remaining crossing.
- Put a connector label on a clear segment with visible separation. If using an opaque backing, keep the backing out of nodes and other important marks; it must not erase a crossing or quantity band.
- Plan painting order: background/groups, connectors, nodes, labels/annotations. Adjust for the chosen grammar and renderer so no later object hides a label or endpoint.

## Adapt to the actual output engine

For PPTX, follow the planned engine. HTML drafts use CSS-pixel layouts with native editable text, tables, solid boxes and simple borders; connectors or advanced charts may be explicit SVG/image artwork. Query jsApi for the supported HTML conversion contract. UNO drafts use the documented native slide text/shape/connect/chart/table methods; query unoApi for exact signatures. Do not invent an API or switch an existing draft engine to follow a visual example.

Map a logical drawing canvas into the allocated figure rectangle: scale = min(availableWidth / canvasWidth, availableHeight / canvasHeight), then center the result. Keep API-specific units separate: HTML positions and type sizes use CSS pixels; the converter maps these to Office units; UNO APIs use their documented units. Recheck readable type sizes at the final destination instead of blindly scaling web pixels. A figure designed for a blog column may need larger labels and fewer overview nodes on a projected slide.

Use native charts for supported statistical families and native tables for tabular data. Word keeps surrounding paragraphs/captions in document flow; spreadsheets keep cells, formulas and charts native. Use an illustration asset only when suitable for the target and its editability requirements, disclosing any flattening. Do not turn entire Office pages into pictures for visual convenience. PDF follows the existing planned Office export path. An HTML artifact is not automatically converted to PDF by file.write.

For explicitly requested HTML/SVG artifacts, use file.write and the current file contract. Prefer local/embedded assets and available fonts; do not import upstream remote fonts or scripts automatically. A static PDF or slide must contain all essential information without hover, playback or animation.

## Review within existing file QA

First verify the semantics: every required entity, direction, branch, state, cardinality and quantity has the right meaning. Then inspect the final rendered size for clipping, overlapping labels, ambiguous crossings, detached arrowheads, font substitution, weak contrast and legend/axis collisions. Verify required native editability separately from the visual appearance. Correct the existing source and use the existing render/visualRead/visualReport workflow; reading this reference or inspecting source geometry is not a visual pass.
`;
