import { z } from 'zod';
export const browserControlShape = {
  url: z.string().max(16000).refine(value => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) || value === 'about:blank'; }
    catch { return false; }
  }, 'Use an absolute HTTP(S) URL or about:blank.').optional(),
  tabOperation: z.enum(['list', 'open', 'select', 'close']).optional(),
  tabId: z.string().min(1).max(300).optional(),
};
export const visualBrowserInputSchema = z.object({
  ...browserControlShape,
  action: z.enum(['observe', 'act', 'images', 'navigate', 'tabs', 'waitForHumanVerification']),
  reason: z.string().min(1).max(300),
  observationId: z.string().optional(),
  kind: z.enum(['click', 'hover', 'move', 'drag', 'scroll', 'type', 'key']).optional(),
  x: z.number().finite().nonnegative().optional(), y: z.number().finite().nonnegative().optional(),
  endX: z.number().finite().nonnegative().optional(), endY: z.number().finite().nonnegative().optional(),
  button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button for click/drag. Default left. Use right for context menus.'),
  clickCount: z.number().int().min(1).max(3).optional().describe('click only: 1 single, 2 double, 3 triple click in one gesture.'),
  modifiers: z.array(z.enum(['Control', 'Shift', 'Alt', 'Meta'])).max(4).optional().describe('Hold these keys throughout one mouse gesture; release afterwards, including on failure.'),
  steps: z.number().int().min(1).max(100).optional().describe('Intermediate mouse moves for drag/move/hover; drag defaults to 12.'),
  deltaX: z.number().finite().optional(), deltaY: z.number().finite().optional(),
  text: z.string().max(20000).optional(), key: z.string().min(1).max(100).optional().describe('One key or simultaneous chord, e.g. Control+v, Control+Shift+v, Shift+ArrowLeft, Alt+ArrowDown.'),
  observationMode: z.enum(['replace', 'append', 'keep-pair']).optional(),
  imageIds: z.array(z.string()).max(12).optional().describe('Select historical image IDs; latest image always remains selected. Empty resets history.'),
  recoveryReview: z.string().max(6000).optional(), maxMs: z.number().int().positive().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.action === 'navigate' && !input.url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'navigate requires url' });
  if (input.action === 'tabs') {
    if (!input.tabOperation) ctx.addIssue({ code: 'custom', path: ['tabOperation'], message: 'tabs requires tabOperation' });
    if (['select', 'close'].includes(input.tabOperation || '') && !input.tabId) ctx.addIssue({ code: 'custom', path: ['tabId'], message: 'select/close requires a tabId from tabs list' });
    if (input.url && input.tabOperation !== 'open') ctx.addIssue({ code: 'custom', path: ['url'], message: 'Only tabs open accepts url' });
  }
  const required = input.action !== 'act' ? [] : ['observationId', 'kind',
    ...(['click', 'hover', 'move', 'drag', 'scroll'].includes(input.kind || '') ? ['x', 'y'] : []),
    ...(input.kind === 'drag' ? ['endX', 'endY'] : []),
    ...(input.kind === 'type' ? ['text'] : []), ...(input.kind === 'key' ? ['key'] : [])];
  for (const key of required) if (input[key as keyof typeof input] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: `Missing ${key}` });
  if (input.action === 'act') {
    const allowed: Record<string, string[]> = { clickCount: ['click'], button: ['click', 'drag'], endX: ['drag'], endY: ['drag'], steps: ['drag', 'move', 'hover'],
      modifiers: ['click', 'drag', 'move', 'hover', 'scroll'] };
    for (const [field, kinds] of Object.entries(allowed)) if (input[field as keyof typeof input] !== undefined && !kinds.includes(input.kind || '')) {
      ctx.addIssue({ code: 'custom', path: [field], message: `${field} is only supported for ${kinds.join('/')}` });
    }
  }
});
export const visualBrowserDescription = 'Pure visual browser. navigate opens an absolute URL in the active tab. tabs lists/opens/selects/closes session tabs through browser controls, without DOM access. observe captures current PNG; act performs one complete page mouse/keyboard gesture, including double/right click, drag and held modifiers, using CURRENT observationId and CSS viewport coordinates. images selects historical comparison images (latest always retained). DOM, AX, JavaScript and locators are unavailable. Old screenshots cannot authorize actions. Call observe after navigation or a stale-action rejection; inspect current state after an uncertain action.';

export const visualBrowserSkill = {
  id: 'system-browser-visual-runtime', title: 'Visual Browser', required: true,
  summary: '<system_skill><id>system-browser-visual-runtime</id><title>Visual Browser</title><description>Observe screenshots and perform one verified mouse or keyboard action.</description></system_skill>',
  content: `${visualBrowserDescription}
Screenshots mark the last successfully executed visual click on the current tab with a red dot of 3 CSS pixels in diameter. This host annotation shows the previous viewport coordinates, not a page element or proof of business success. Rejected actions do not move the dot. The annotation is excluded from visualChanged.
Read the current screenshot before choosing a target. All coordinates are CSS pixels in the full current viewport, using the observation width/height, not a resized preview. observe refreshes without acting. act requires kind and observationId. click/hover/move/drag/scroll require x,y. click supports button left/right/middle and clickCount 1/2/3. A real double click is ONE act with clickCount:2, never separate clicks across model turns. drag moves from x,y to endX,endY while holding button (default left); steps controls intermediate moves. hover/move moves without pressing a button. scroll accepts deltaX/deltaY at x,y. Mouse gestures accept modifiers ["Control","Shift","Alt","Meta"] held for the entire gesture and released afterwards; for example Control+click, Shift+drag, Control+scroll.
type inserts text into the already focused page control; click to focus first. key takes a single key or simultaneous chord: "Control+v" for paste, "Control+c" for copy, "Control+Shift+v", "Shift+ArrowLeft", etc. Paste uses the browser/system clipboard; do not assume it contains the desired text. Use type for supplied literal text. The host refreshes before acting and rejects changed document, route, surface, scroll position or viewport (including zoom). Pixel changes alone, such as live video, chat or caret blinking, do not invalidate the action. This does not verify that the target stayed in place or remained uncovered: choose unambiguous targets from the current screenshot and observe again if layout or focus is uncertain. Reobserve and decide again after rejection. Browser changes between capture and input cannot be eliminated entirely.
Use observationMode replace for navigation, append for continuous inspection, keep-pair for comparisons. images with imageIds selects comparison evidence; an empty list clears historical selection. Current is always retained. After a failure, inspect the actual new image and put evidence-based diagnosis and a changed recovery action in recoveryReview. Unknown execution is recorded without locking the conversation; inspect current state before deciding how to continue. A completed gesture is not business success. visualChanged:false means no screenshot/route change was observed at capture time; it is not proof of no effect. Do not keep clicking the same coordinates without new evidence. Check focus, loading and the intended gesture (single/double/right click or drag).
For URL navigation use {action:"navigate",url:"https://example.com/path#route",reason:"..."}. To open a new tab use {action:"tabs",tabOperation:"open",url:"https://example.com",reason:"..."}; omit url for about:blank. Use tabs with tabOperation list to get session tab IDs, then select or close with tabId. These are browser controls and require no screenshot coordinates. After changing page or tab, observe and verify the current screenshot before page interaction. act key goes only to the webpage: it CANNOT focus the browser address bar, open/switch/close tabs, or operate browser chrome. Do not use Control+l/Control+t for navigation. Credentials, OTP and file chooser operations needing user input use waitForHumanVerification. Never fabricate a locator, use DOM/AX, execute JavaScript or route browser page extraction through another tool.
Historical tool output is archived by ref and read on demand with contextRead. Keep user requirements exact, record unverified task notes separately, and verify visible outcomes before claiming completion.`,
  activation: [{ toolName: 'browser', actions: ['observe', 'act', 'images', 'navigate', 'tabs', 'waitForHumanVerification'] }],
};
