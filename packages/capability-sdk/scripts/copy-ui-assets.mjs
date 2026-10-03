import { copyFile, mkdir } from 'node:fs/promises';

// tsc emits the component but does not copy its imported stylesheet.
await mkdir(new URL('../dist/media/', import.meta.url), { recursive: true });
await copyFile(new URL('../src/media/video-editor.css', import.meta.url), new URL('../dist/media/video-editor.css', import.meta.url));
