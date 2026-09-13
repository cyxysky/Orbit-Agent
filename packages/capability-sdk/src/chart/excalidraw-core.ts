/** Serializable scene contract; importing it never loads the browser editor. */
export type ExcalidrawScene = Record<string, unknown> & {
  elements: Array<Record<string, unknown>>;
  appState: Record<string, unknown>;
  files: Record<string, Record<string, unknown>>;
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const elementTypes = new Set(['rectangle', 'diamond', 'ellipse', 'text', 'arrow', 'line', 'freedraw', 'image', 'frame', 'magicframe', 'iframe', 'embeddable']);
const sceneStateKeys = ['viewBackgroundColor', 'gridSize', 'gridStep', 'gridModeEnabled', 'theme', 'exportBackground', 'exportWithDarkMode', 'exportScale', 'exportEmbedScene'] as const;

export function normalizeExcalidrawOption(value: unknown): ExcalidrawScene {
  if (!object(value) || !Array.isArray(value.elements)) throw new Error('Excalidraw option.elements must be an array.');
  if (value.elements.length > 10000) throw new Error('Excalidraw supports at most 10000 elements per chart.');
  if (value.appState !== undefined && !object(value.appState)) throw new Error('Excalidraw appState must be an object.');
  // Text/shape-only scenes have no binary resources. Generated tool inputs use
  // an empty string or empty array for this optional map; neither carries data.
  // Image elements still require their actual resource below.
  const emptyFiles = value.files === undefined
    || (typeof value.files === 'string' && !value.files.trim())
    || (Array.isArray(value.files) && value.files.length === 0);
  const sourceFiles = emptyFiles ? {} : value.files;
  if (!object(sourceFiles)) {
    const received = Array.isArray(sourceFiles) ? 'array' : sourceFiles === null ? 'null' : typeof sourceFiles;
    throw new Error(`Excalidraw option.files must be an object keyed by fileId; received ${received}. Omit files for a scene without images. For images, pass files: {"file-id": {"id":"file-id","mimeType":"image/png","dataURL":"data:image/png;base64,..."}}. Do not repeat the same invalid input.`);
  }
  const ids = new Set<string>();
  const elements = value.elements.map((element, index) => {
    const label = `option.elements[${index}]`;
    if (!object(element) || typeof element.id !== 'string' || !element.id || ids.has(element.id)) throw new Error(`${label} requires a unique nonempty id.`);
    ids.add(element.id);
    if (!elementTypes.has(String(element.type))) throw new Error(`${label} has an unsupported element type.`);
    for (const key of ['x', 'y', 'width', 'height']) {
      if (typeof element[key] !== 'number' || !Number.isFinite(element[key])) throw new Error(`${label}.${key} must be finite.`);
    }
    if ((element.width as number) < 0 || (element.height as number) < 0) throw new Error(`${label} dimensions must be nonnegative.`);
    if (element.type === 'text' && typeof element.text !== 'string') throw new Error(`${label}.text is required.`);
    if (['line', 'arrow', 'freedraw'].includes(String(element.type)) && (!Array.isArray(element.points) || element.points.length < 2 || element.points.some((point: unknown) => !Array.isArray(point) || point.length !== 2 || point.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n))))) throw new Error(`${label}.points requires at least two finite [x,y] pairs.`);
    return element;
  });
  const files: ExcalidrawScene['files'] = Object.create(null);
  for (const [id, file] of Object.entries(sourceFiles)) {
    if (!object(file) || file.id !== id || typeof file.mimeType !== 'string' || !file.mimeType.startsWith('image/') || typeof file.dataURL !== 'string' || !file.dataURL.startsWith(`data:${file.mimeType};base64,`)) throw new Error(`option.files.${id} requires matching id, image mimeType and base64 dataURL.`);
    files[id] = file;
  }
  for (const element of elements) {
    if (element.type === 'image' && !element.isDeleted && (typeof element.fileId !== 'string' || !files[element.fileId])) throw new Error(`Image ${element.id} requires its binary resource in option.files.`);
  }
  const state = object(value.appState) ? value.appState : {};
  for (const key of ['gridModeEnabled', 'exportBackground', 'exportWithDarkMode', 'exportEmbedScene']) {
    if (state[key] !== undefined && typeof state[key] !== 'boolean') throw new Error(`appState.${key} must be boolean.`);
  }
  for (const key of ['gridSize', 'gridStep', 'exportScale']) {
    if (state[key] !== undefined && state[key] !== null && (typeof state[key] !== 'number' || !Number.isFinite(state[key]) || state[key] <= 0)) throw new Error(`appState.${key} must be a positive finite number.`);
  }
  if (state.theme !== undefined && state.theme !== 'light' && state.theme !== 'dark') throw new Error('appState.theme must be light or dark.');
  if (state.viewBackgroundColor !== undefined && typeof state.viewBackgroundColor !== 'string') throw new Error('appState.viewBackgroundColor must be a color string.');
  const appState = Object.fromEntries(sceneStateKeys.filter((key) => state[key] !== undefined).map((key) => [key, state[key]]));
  // UI selections, collaborators, menus and DOM references are not document data.
  return JSON.parse(JSON.stringify({ elements, appState, files })) as ExcalidrawScene;
}
