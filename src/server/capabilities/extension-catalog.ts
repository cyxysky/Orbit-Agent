export type ExtensionToolCatalogItem = { name: string; label: string; description: string; revision: string };
let tools: readonly ExtensionToolCatalogItem[] = [];
export function publishExtensionToolCatalog(value: readonly ExtensionToolCatalogItem[]) { tools = Object.freeze([...value]); }
export function extensionToolCatalog() { return tools; }
