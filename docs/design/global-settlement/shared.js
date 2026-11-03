(() => {
  window.OrbitPages = {};
  window.OrbitOverlays = {};
  const paths = {
    orbit:'<ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="7"/><circle cx="19" cy="5" r="2" fill="currentColor"/>',
    chat:'<path d="M21 11a8 8 0 0 1-8 8H5l-4 3V11a8 8 0 0 1 8-8h4a8 8 0 0 1 8 8Z"/><path d="M7 9h8M7 13h5"/>',
    automation:'<rect x="8" y="2" width="8" height="6" rx="1"/><rect x="2" y="16" width="7" height="6" rx="1"/><rect x="15" y="16" width="7" height="6" rx="1"/><path d="M12 8v4M5 16v-4h14v4"/>',
    settings:'<path d="m9 3 1-2h4l1 2 3 2 2 0 2 4-1 2v3l1 2-2 4h-2l-3 2-1 1h-4l-1-1-3-2H4l-2-4 1-2v-3L2 9l2-4h2Z" transform="translate(1 0) scale(.9)"/><circle cx="12" cy="11" r="3"/>',
    chart:'<path d="M4 3v17h17M8 15v-5M13 15V6M18 15v-8"/>',
    file:'<path d="M5 2h9l5 5v15H5Z M14 2v6h5M8 12h8M8 16h6"/>',
    folder:'<path d="M2 6h8l2 3h10v12H2ZM2 6V3h7l3 3h8v3"/>',
    browser:'<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20M5 5.5h.01M8 5.5h.01M11 5.5h.01"/>',
    terminal:'<rect x="2" y="3" width="20" height="18" rx="2"/><path d="m6 8 4 4-4 4M13 16h5"/>',
    memory:'<path d="M12 4c-4-4-8 0-6 3-5 0-5 7-1 8-2 4 3 8 7 4M12 4c4-4 8 0 6 3 5 0 5 7 1 8 2 4-3 8-7 4V4ZM6 7l2 3M5 15h3M18 7l-2 3M19 15h-3"/>',
    shield:'<path d="m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6Z"/><path d="m8 12 3 3 5-6"/>',
    key:'<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9M16 16l3-3M19 19l3-3"/>',
    skill:'<path d="m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18"/>',
    plus:'<path d="M12 4v16M4 12h16"/>',
    search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
    'arrow-left':'<path d="M20 12H4m6-6-6 6 6 6"/>',
    'chevron-right':'<path d="m9 5 7 7-7 7"/>',
    'chevron-down':'<path d="m5 9 7 7 7-7"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    download:'<path d="M12 2v13m-5-5 5 5 5-5M3 16v5h18v-5"/>',
    upload:'<path d="M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5"/>',
    play:'<path d="m7 3 14 9-14 9Z"/>',
    pause:'<path d="M8 4v16M16 4v16"/>',
    refresh:'<path d="M21 10A9 9 0 0 0 5 5L2 8m0-6v6h6M3 14a9 9 0 0 0 16 5l3-3m0 6v-6h-6"/>',
    link:'<path d="m9 15 6-6M8 17l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 7l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(2 0) scale(.85)"/>',
    bookmark:'<path d="M5 3h14v19l-7-5-7 5Z"/>',
    attachment:'<path d="m9 12 7-7a4 4 0 0 1 6 6L11 22a6 6 0 0 1-9-9L13 2m-7 13 10-10" transform="translate(2 0) scale(.85)"/>',
    menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
    panel:'<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 3v18"/>',
    user:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
    bell:'<path d="M5 9a7 7 0 0 1 14 0v7l2 2H3l2-2ZM9 21h6"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2"/>',
    eye:'<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/>',
    trash:'<path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M9 10v7M15 10v7"/>',
    code:'<path d="m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18"/>',
    globe:'<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/>',
    info:'<circle cx="12" cy="12" r="10"/><path d="M12 10v7M12 6h.01"/>',
    lock:'<rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v4"/>',
    send:'<path d="m3 3 19 9-19 9 4-9ZM7 12h15"/>',
    calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M7 1v6M17 1v6M3 10h18M7 14h3M14 14h3M7 18h3"/>',
    edit:'<path d="m15 3 6 6M3 21l2-7L17 2l5 5-12 12ZM3 21l7-2"/>',
    copy:'<rect x="7" y="7" width="14" height="15" rx="2"/><path d="M17 7V2H2v15h5"/>',
    image:'<rect x="2" y="3" width="20" height="18" rx="2"/><circle cx="7" cy="8" r="2"/><path d="m2 17 6-5 4 3 4-6 6 7"/>'
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.file}</svg>`;
  const button = (label,attrs='',tone='') => `<button type="button" class="btn ${tone ? 'btn-'+tone : ''}" ${attrs}>${label}</button>`;
  const field = (label,value='',type='text',hint='') => `<label class="field"><span>${esc(label)}</span>${type==='textarea'?`<textarea rows="4">${esc(value)}</textarea>`:`<input type="${esc(type)}" value="${esc(value)}" ${type==='password'?'autocomplete="new-password"':''}>`}${hint?`<small>${esc(hint)}</small>`:''}</label>`;
  const select = (label,options,selected) => `<label class="field"><span>${esc(label)}</span><select>${options.map(item=>{const value=typeof item==='object'?item.value:item;const text=typeof item==='object'?item.label:item;return `<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(text)}</option>`}).join('')}</select></label>`;
  const switchRow = (label,description,on=true) => `<div class="setting-row"><div><strong>${esc(label)}</strong>${description?`<p class="muted small">${esc(description)}</p>`:''}</div><button type="button" class="switch ${on?'on':''}" role="switch" aria-checked="${on}" aria-label="${esc(label)}"></button></div>`;
  const panel = (title,body,extra='') => `<section class="panel"><header class="panel-head"><h2>${title}</h2>${extra}</header><div class="panel-body">${body}</div></section>`;
  window.OrbitUI={icon,button,field,select,switchRow,panel,esc};
})();
