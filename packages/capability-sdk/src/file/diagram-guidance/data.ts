/** Adapted from Diagram Design; see ../../THIRD_PARTY_NOTICES.md. */
export const diagramData = `# Quantitative and comparison figures

Use with system-file-diagram-design when selecting or laying out a data figure. This guidance supplements the file Skill's factual-data rules and native-chart requirements; it does not justify drawing a supported Office chart as a picture or as hundreds of shapes.

| Question | Candidate | Condition |
| --- | --- | --- |
| Compare magnitudes or rank categories | Bar/column | Compatible units; horizontal bars for long names |
| Compare two observations per category | Paired dots/dumbbell or grouped bars | Matched categories and a shared scale |
| Show change over time | Line | Ordered observations, actual intervals, explicit gaps |
| Relate quantitative variables | Scatter/bubble | Explain units and any bubble-area encoding; correlation is not causation |
| Explain parts of a total | Stacked bar, treemap or a simple part-to-whole chart | Complete denominator, compatible nonnegative values |
| Explain quantities splitting/merging | Sankey | Measured flows and reconciled totals |
| Compare two positioning dimensions | Quadrant | Explain axes, thresholds and whether placement is qualitative |
| Compare multiple criteria | Radar or a table | Comparable scales/directions; sourced criteria, no invented scores |
| Show progressive attrition | Funnel | Defined population and stage counts, or label as conceptual |

## Scales and layout

Reserve space for the real category names, values, axes and legend before sizing the plot. Switch orientation, wrap labels or split comparable panels before shrinking type. Keep series encoding consistent across the document; repeated series colors are meaningful, not a violation of a one-highlight aesthetic. Direct labels can replace a legend when they reduce lookup without causing clutter.

Bars used for magnitude comparisons normally start at zero; explain any unusual baseline and consider a different chart when a truncated bar would mislead. Negative values need a visible zero and correct direction. Preserve missing values distinctly from zero. Compare panels on the same scale when the comparison depends on magnitude, or visibly disclose different scales. Encode bubble magnitude by area, not radius, and avoid perspective/depth effects that alter perceived size.

For timelines and quantitative plots, factual positions take precedence over layout-grid rounding. Do not change data values to make a drawing fit. Derive displayed totals, labels and geometry from the same dataset used by the native chart.

## Flow quantities

For a Sankey, choose one units-to-width scale across stages, order nodes to reduce crossings, and allocate separate endpoint intervals to each band. Reconcile incoming/outgoing quantities; represent a measured loss/gain explicitly instead of hiding imbalance. Keep bands attached to their intended nodes and place labels in clear gutters, not on opaque masks that erase quantity areas. If very small flows are grouped as other, preserve their total and identify the grouping. A single narrowing chain without branching may be a funnel; a flow without measured quantities is a process diagram.

## Implementation and checks

Query the selected JavaScript/UNO chart API before choosing a native implementation. A supported bar, line, radar, scatter or other standard family stays native and editable, and standard tables remain native tables. For an unsupported special infographic, use native shapes where feasible or a clearly identified illustration asset when its editability tradeoff is acceptable. Never imply a special native chart type exists just because this reference describes it.

Check units, denominator, date/period, ordering, totals, source provenance and uncertainty independently of appearance. In the final render inspect axis labels, smallest marks, legend mapping, value-label collisions and misleading crop/baseline effects. Required data must remain readable in static output and accessible through labels or accompanying native text/table when the graphic alone is insufficient.
`;
