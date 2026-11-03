export type ChartDownload = (data: Blob | string, filename: string) => Promise<void>;

/** Sandboxed hosts can supply their download bridge; ordinary browsers use links. */
export async function downloadChartFile(data: Blob | string, filename: string, onDownload?: ChartDownload) {
  if (onDownload) return onDownload(data, filename);
  const url = typeof data === 'string' ? data : URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000);
}
