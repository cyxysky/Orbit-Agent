const protocolNames = ['tool_call', 'minimax:tool_call', 'function_calls', 'invoke'];
const toolStub = /^\[Tool call:\s*([\w.-]+)\]\s*(\{[\s\S]*\})$/i;

/** Hide provider call syntax without interpreting or executing it. Markdown examples remain text. */
export function modelVisibleText(value: string, streaming = false) {
  if (streaming && /^\[Tool call:/i.test(value.trimStart())) return '';
  const stub = value.trim().match(toolStub);
  if (stub) {
    try { const call = JSON.parse(stub[2]); if (call?.name === stub[1] && call.arguments && typeof call.arguments === 'object') return ''; }
    catch { /* Incomplete provider syntax is handled below. */ }
  }
  let result = '', fence = '', inline = 0;
  for (let index = 0; index < value.length;) {
    if (value[index] === '`' || value[index] === '~' && value.slice(index, index + 3) === '~~~') {
      const marker = value[index];
      let end = index + 1; while (value[end] === marker) end++;
      const length = end - index;
      if (length >= 3 && !inline) {
        if (!fence) fence = marker.repeat(length);
        else if (fence[0] === marker && length >= fence.length) fence = '';
      } else if (!fence && marker === '`') inline = inline ? length === inline ? 0 : inline : length;
      result += value.slice(index, end); index = end; continue;
    }
    if (!fence && !inline && ['<', '◁', '＜'].includes(value[index])) {
      const open = value[index], close = open === '<' ? '>' : open === '◁' ? '▷' : '＞';
      const tail = value.slice(index);
      const opening = tail.match(new RegExp(`^${open}\\s*(tool_call|minimax:tool_call|function_calls|invoke)\\b[^${close}]*${close}`, 'i'));
      if (opening) {
        const closing = new RegExp(`${open}\\s*/${opening[1]}\\s*${close}`, 'i').exec(tail.slice(opening[0].length));
        if (!closing) break;
        index += opening[0].length + closing.index + closing[0].length; continue;
      }
      const closing = tail.match(new RegExp(`^${open}\\s*/(?:tool_call|minimax:tool_call|function_calls|invoke)\\s*${close}`, 'i'));
      if (closing) { index += closing[0].length; continue; }
      const lower = tail.slice(1).trimStart().toLowerCase();
      if (protocolNames.some(name => lower === name || lower.startsWith(name + ' '))
        || streaming && protocolNames.some(name => name.startsWith(lower))) break;
    }
    result += value[index++];
    if (value[index - 1] === '\n' && !fence) inline = 0;
  }
  return result;
}

export function containsModelToolProtocol(value: string) {
  return modelVisibleText(value) !== value;
}
