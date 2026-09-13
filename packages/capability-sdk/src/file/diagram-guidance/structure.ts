/** Adapted from Diagram Design; see ../../THIRD_PARTY_NOTICES.md. */
export const diagramStructure = `# Structure and relationship diagrams

Use with system-file-diagram-design for layout and engine adaptation. Pick the relationship first; the following grammars are alternatives, not templates to combine indiscriminately.

| Reader's question | Grammar | Preserve |
| --- | --- | --- |
| What are the components and interfaces? | Architecture | Components, boundaries, communication/storage relationships |
| Where does software run? | Deployment | Hosts/zones, deployed artifacts, replicas and relevant ingress |
| What depends on what? | Dependency graph | Direction convention, shared dependencies, cycles |
| What is part of what? | Tree or nested containment | Parent-child identity and complete ancestry |
| Who owns or reports to whom? | Organization chart | Ownership/reporting meaning; distinguish collaboration |
| Which abstractions build on others? | Layer stack | Layer responsibility and direction of use |
| Which data entities relate? | ER or physical schema | Keys, optionality/cardinality; physical types/FKs when requested |

## Architecture and deployment

Place related components in named zones for a real boundary: deployment, ownership or trust. Avoid a decorative zone with no meaning. Keep component roles distinct, and label edges with the actual relationship where direction alone is ambiguous. Separate runtime request flow, static dependency and deployment relationships through a clear legend or separate views.

For deployment, place software artifacts inside their actual hosts/zones and label replicas explicitly. Include ports, identity and environment only when supplied and relevant. A boundary labeled secure does not establish security; when access is the subject, show allowed entry, denied/bypass routes, enforcement and audit with explicit labels. A blocked path stops at the boundary rather than visually joining the permitted flow.

## Dependency graphs

State whether A → B means A depends on B or B supplies A. Keep that convention across every edge. Arrange acyclic groups by dependency depth; isolate cycles as named groups or route back-edges outside the main ranks. Shared dependencies may have several incoming edges, so do not force the graph into a tree. If fan-in matters, compute it from the represented graph and identify whether the count is local or includes hidden dependencies. Do not invent a cycle to make the figure visually interesting or hide additional cycles to meet a style budget.

## Trees, organizations and layers

Use a tree only when the represented relationship has one parent per child. Allocate subtree widths from descendants before positioning the parent; preserve intermediate levels. A common trunk can intentionally join sibling branches when all share the same parent relationship. Nesting shows scope/containment, not execution order. In an organization chart, label dotted-line or matrix relationships separately from reporting lines. Layer stacks should name each layer's responsibility rather than repeat vague platform labels.

For deep hierarchies, show a meaningful top-level view and cross-reference detailed subtrees with stable names/IDs. Keep full traceability in existing notes or metadata when required; do not add a separate registry artifact unless the task needs one. Preserve the original terminology for products and implementation components.

## Data models and classes

Choose conceptual ER for entities/relationships and physical schema for actual tables, columns, keys, indexes and column-level foreign keys. Size entity boxes to their real fields; align key/attribute columns without padding every entity to the largest height. Label relationship cardinality and optionality consistently at the correct ends. Group related entities before routing links, and distinguish a subset overview from a complete schema.

Use a class diagram when operations, inheritance or composition matter. Keep class inheritance, object containment and table foreign keys semantically distinct; consult actual source definitions rather than infer them from names. Native text and shapes should remain editable in PPTX, including field lists. If a notation requires an unsupported endpoint marker, use an explicit textual equivalent and disclose the approximation rather than claim standards conformance.

## Focused checks

Trace each displayed edge against the source, verify boundary membership, count/label any grouped components, inspect densely connected hubs, and confirm that a connector never suggests interaction with a node it merely passes. Verify that simplification preserves the relationships the user asked to understand.
`;
