import type { CapabilitySkill } from '../index.ts';
import { markdownBlock } from '../responses/index.ts';
import { chartResponseBlock } from './response.ts';
import { standardChartSeries } from './core.ts';

/** Complete model-facing operating manual for the Chart Capability workflow. */
export const chartRuntimeSkillId = 'system-chart-runtime';

export const chartRuntimeSkillSummary = [
  '<system_skill>',
  `<id>${chartRuntimeSkillId}</id>`,
  '<title>ECharts, Three.js and Excalidraw Chart Runtime</title>',
  '<description>Operating manual for creating, reading and updating persistent 2D/3D charts with fullscreen, downloads and manual data editing.</description>',
  '<required>true</required>',
  '</system_skill>',
].join('\n');

export const chartRuntimeSkillContent = `# ECharts, Three.js and Excalidraw Chart Runtime

This Skill is authoritative for the chart model tool and is supplied by the chart package. The consuming Agent is responsible for loading it and deciding when the chart tool becomes available.

## Required workflow

1. When a visual chart materially improves the answer, explicitly read this Skill and wait for that read to succeed before calling chart.
2. Before creating a chart, call chart with action \`api\` and no query to read the compact API module index.
3. Call action \`api\` again with the exact module id needed for the requested chart. Read more than one module when the design combines series, coordinates, datasets, maps, or interactions.
4. Choose the engine by the requested output. Flowcharts, architecture, organization diagrams, wireframes and free-form visuals MUST use \`engine:"excalidraw"\`: read module \`excalidraw\`, then supply elements plus optional appState. Statistical charts use the fixed ECharts series types listed below. Native 3D statistics use module \`three\` and \`engine:"three"\`. Call \`create\` with the complete option for that engine. Omit files when there are no images; image resources use an object keyed by fileId.
5. After a successful create, finish with \`finalResponse\` and copy the exact content[].block into its blocks array at the intended position. Do not finish with plain Markdown containing a chart identifier. Use the registered types and params from the finalResponse tool schema.
6. Never invent an identifier and never reference one after a failed call. Charts render through registered response blocks with type and params. Include each chartId once; do not also append it to a Markdown block.

Markdown never renders charts. Identifiers such as \`chart_000001\`, including standalone lines and code examples, remain ordinary text.
An \`api\` call only reads documentation; it never creates a chart. Do not describe
a chart as generated or present until \`create\` succeeds and its response block
is delivered. Include the actual series/elements in the submitted option;
titles, descriptions and a planned layout alone do not draw anything.

## Layout and labels

The host displays the saved chart title; when an ECharts title repeats it, the
host keeps only the title drawn inside the chart. Keep the export's title intact.
Set title/subtitle text widths and overflow wrapping for long copy, and reserve
enough space before the plot. Use media queries for narrower containers. Supply
a wide/default rule restoring the fields overridden by narrow rules.

For Excalidraw diagrams, use native rectangles/diamonds/text/arrows and explicit
coordinates. Group each node with its labels, and bind connectors to nodes so
moving a node preserves its connections. Leave room between nodes and labels;
use actual newline characters, encoded once as \`\\n\` in JSON. Use roughness:0 for
precise product diagrams. Keep the complete scene readable when fitted and allow
native zoom/pan for detail. Never emulate flowcharts with ECharts graphic,
graph, tree, scatter markers, coordinate paths or custom series.

## Supported ECharts surface

ECharts accepts these fixed statistical series types: ${standardChartSeries.join(', ')}. Mixed charts may combine supported types. ECharts \`graphic\`, \`graph\`, \`tree\` and \`custom\` are unavailable, including in baseOption, media and timeline variants. Use Excalidraw for custom diagrams instead.

Supported series can use grid/cartesian, polar, radar, geo, parallel, singleAxis, calendar, matrix, dataset, built-in transforms, visualMap, dataZoom, timeline, brush, title, legend, tooltip, toolbox and animation options.

Every \`lines\` series must declare its coordinate system and include the matching top-level components: \`cartesian2d\` requires \`xAxis\` and \`yAxis\`; \`geo\` requires \`geo\`; \`polar\` requires \`polar\`, \`radiusAxis\`, and \`angleAxis\`; \`calendar\` requires \`calendar\`; and \`matrix\` requires \`matrix\`. Omitting \`coordinateSystem\` makes ECharts assume \`geo\`, so never omit it.

Map charts may pass \`maps\`; each map is registered before \`setOption\`. The \`geoJson\` value may be a GeoJSON object or SVG XML string.

Tool arguments are JSON. Executable callbacks, external event handlers and third-party series registration are unavailable. Use the supported statistical types and string templates.

Use only string templates for \`formatter\`; never put \`"function(params){...}"\` or \`"(params) => ..."\` strings into it. ECharts treats formatter strings as text templates, not JavaScript. Omit \`valueFormatter\`: ECharts accepts only a JavaScript function for this field, not a string template, so the persisted JSON chart cannot use it. Chart create/update rejects invalid formatters with their exact option path. For tooltips prefer \`{ trigger: "axis" }\` (default formatting) or a \`formatter\` template such as \`"{b}: {c}"\`; indexed templates such as \`"{b0}<br/>{a0}: {c0}<br/>{a1}: {c1}"\` support fixed multiple series. A waterfall's invisible spacer series should use \`tooltip: { show: false }\` so its offset is not reported as business data.

## Editing, export and 3D

Each rendered chart provides fullscreen, PNG and JSON downloads, CSV downloads for data arrays, and manual data editing through a table or complete option JSON. SVG-rendered ECharts additionally supports SVG downloads. In Orbit, saving persists to the original chart ID; refreshes and later tool reads see the saved version. Standalone React hosts must supply onSave to persist edits.

Before modifying an existing chart, call action \`read\` with its chartId. Use the returned chart.option and revision, preserve unrelated settings and user edits, then call action \`update\` with the complete option and expectedRevision. On chart-revision-conflict, read again and merge; do not blindly retry with a newer revision. A failed update leaves the saved chart unchanged.

Three.js supports \`bar3D\`, \`scatter3D\`, \`line3D\` and \`surface3D\`. Each point is [x,y,z], with z representing height. Surface data is row-major and requires grid.rows × grid.columns to equal the point count. Read module \`three\` for complete limits and examples. The viewport supports rotation, zoom, pan and PNG export. Simple 2D bar/line/scatter charts offer a temporary view toggle labeled "3D 视图" / "2D 视图"; complex coordinate encodings remain in their original 2D form. Data editing opens a modal with table and JSON modes. Native 3D requires WebGL2.

## API signature

\`\`\`ts
type ChartApiInput = {
  action: "api";
  reason: string;
  query?: string;  // Omit for the index; otherwise use one exact module id.
  offset?: number;
  limit?: number;
};

type ChartCreateInput = {
  action: "create";
  reason: string;
  engine?: "echarts" | "three" | "excalidraw";
  option: Record<string, unknown>; // Complete option for the selected engine.
  title?: string;
  description?: string;
  height?: number;                // 240..720, default 380.
  renderer?: "canvas" | "svg";  // default canvas.
  maps?: Array<{
    name: string;
    geoJson: Record<string, unknown> | string;
    specialAreas?: Record<string, unknown>;
  }>;
};

type ChartReadInput = { action: "read"; reason: string; chartId: string };
type ChartUpdateInput = Omit<ChartCreateInput, "action"> & { action: "update"; chartId: string; expectedRevision: number };

declare function chart(input: ChartApiInput | ChartCreateInput | ChartReadInput | ChartUpdateInput): Promise<{
  ok: boolean;
  actual: string;
  failureCategory?: string;
}>;
\`\`\`

## API examples

Read the API module index:

\`\`\`js
chart({
  action: "api",
  reason: "查看 ECharts API 模块索引"
})
\`\`\`

Read an exact module returned by the index:

\`\`\`js
chart({
  action: "api",
  reason: "读取直角坐标系列配置说明",
  query: "series.cartesian"
})
\`\`\`

Create a mixed bar and line chart:

\`\`\`js
chart({
  action: "create",
  reason: "同时展示销售额和同比增速",
  title: "销售额与同比增速",
  height: 380,
  renderer: "canvas",
  option: {
    tooltip: { trigger: "axis" },
    legend: { data: ["销售额", "同比增速"] },
    grid: { left: 48, right: 48, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: ["Q1", "Q2", "Q3", "Q4"] },
    yAxis: [
      { type: "value", name: "万元" },
      { type: "value", name: "%" }
    ],
    series: [
      { name: "销售额", type: "bar", data: [320, 410, 465, 530] },
      { name: "同比增速", type: "line", yAxisIndex: 1, smooth: true, data: [8, 12, 10, 15] }
    ]
  }
})
\`\`\`

Create a registered map chart:

\`\`\`js
chart({
  action: "create",
  reason: "展示区域指标分布",
  title: "区域指标分布",
  maps: [{
    name: "sales-region",
    geoJson: {
      type: "FeatureCollection",
      features: []
    }
  }],
  option: {
    visualMap: { min: 0, max: 100, calculable: true },
    series: [{
      type: "map",
      map: "sales-region",
      data: [{ name: "A 区", value: 82 }]
    }]
  }
})
\`\`\`

After a successful call returns \`chart_000001\`, place it in the final response like this:

\`\`\`js
finalResponse(${JSON.stringify({ status: 'passed', blocks: [
  markdownBlock('下面是销售额与同比增速的对比：'),
  chartResponseBlock({ chartId: 'chart_000001', title: '销售额与同比增速' }),
  markdownBlock('第四季度两项指标同时达到全年最高点。'),
] }, null, 2)})
\`\`\`
`;

export const chartCapabilityRuntimeSkill = Object.freeze({
  id: chartRuntimeSkillId,
  title: 'ECharts, Three.js and Excalidraw Chart Runtime',
  summary: chartRuntimeSkillSummary,
  content: chartRuntimeSkillContent,
  required: true,
  activation: [{ toolName: 'chart' }],
} satisfies CapabilitySkill);
