import './style.css'
import { generateResultCode } from './generateCode1c'
import type { SelectorData, SelectorParam } from './generateCode1c'
import { initSelectorEdit, updateSelectorsList, clearActiveParent } from './selectorEdit'

const selectedSelectors: SelectorData[] = []
let isSelecting = false
let isShowing = false
let currentSrc: string | null = null
let currentTemplateId: number | null = null

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="controls">
    <select id="project-select" class="project-select">
      <option value="">-- Виберіть проект --</option>
    </select>
    <input type="text" id="template-name-input" class="template-name-input" placeholder="Назва шаблону" disabled />
    <button id="delete-template-btn" class="select-btn delete-btn" disabled>Видалити</button>
    <div class="file-input-wrapper">
      <label class="file-input-label" for="file-input">
        <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
        </svg>
        Choose HTML File
      </label>
      <input type="file" id="file-input" accept=".html" />
    </div>
    <select id="element-type" class="element-type">
      <option value="">All Types</option>
      <option value="div">div</option>
      <option value="p">p</option>
      <option value="span">span</option>
      <option value="a">a</option>
      <option value="table">table</option>
      <option value="tr">tr</option>
      <option value="td">td</option>
      <option value="th">th</option>
      <option value="ul">ul</option>
      <option value="ol">ol</option>
      <option value="li">li</option>
      <option value="h1">h1</option>
      <option value="h2">h2</option>
      <option value="h3">h3</option>
      <option value="button">button</option>
      <option value="input">input</option>
      <option value="form">form</option>
      <option value="img">img</option>
    </select>
    <button id="select-btn" class="select-btn" disabled>Select Elements</button>
    <button id="show-btn" class="select-btn" disabled>Show Elements</button>
    <button id="save-btn" class="select-btn" disabled style="display:none">Save</button>
    <button id="load-btn" class="select-btn" style="display:none">Load</button>
    <input type="file" id="load-input" accept=".json" style="display:none" />
  </div>
  <div id="parent-info" class="parent-info" style="display:none"></div>
  <div id="selectors-io-toolbar">
    <button id="export-selectors-btn" class="select-btn small" disabled>Експорт JSON</button>
    <button id="import-json-btn" class="select-btn small" disabled>Імпорт JSON</button>
    <input type="file" id="import-selectors-input" accept=".json" style="display:none" />
  </div>
  <div id="selectors-list" class="selectors-list"></div>
  <div id="result-content">
    <div class="result-toolbar">
      <button id="generate-result-btn" class="select-btn small">Generate</button>
      <button id="copy-result-btn" class="select-btn small">Копіювати</button>
      <label class="toolbar-checkbox-label">
        <input type="checkbox" id="create-function-cb" checked />
        create function
      </label>
      <input type="text" id="function-name-input" class="function-name-input" value="GetHTMLTemplate" placeholder="function name" />
    </div>
    <textarea id="result-code" class="result-code" spellcheck="false"></textarea>
  </div>
`

document.querySelector<HTMLDivElement>('#frame')!.innerHTML = `
  <div class="placeholder">Select an HTML file to preview</div>
`

const fileInput = document.querySelector<HTMLInputElement>('#file-input')!
const selectBtn = document.querySelector<HTMLButtonElement>('#select-btn')!
const showBtn = document.querySelector<HTMLButtonElement>('#show-btn')!
const saveBtn = document.querySelector<HTMLButtonElement>('#save-btn')!
const loadBtn = document.querySelector<HTMLButtonElement>('#load-btn')!
const loadInput = document.querySelector<HTMLInputElement>('#load-input')!
const elementType = document.querySelector<HTMLSelectElement>('#element-type')!
const selectorsList = document.querySelector<HTMLDivElement>('#selectors-list')!
const parentInfo = document.querySelector<HTMLDivElement>('#parent-info')!
const projectSelect = document.querySelector<HTMLSelectElement>('#project-select')!
const templateNameInput = document.querySelector<HTMLInputElement>('#template-name-input')!
const functionNameInput = document.querySelector<HTMLInputElement>('#function-name-input')!
const deleteTemplateBtn = document.querySelector<HTMLButtonElement>('#delete-template-btn')!
const exportSelectorsBtn = document.querySelector<HTMLButtonElement>('#export-selectors-btn')!
const importSelectorsBtn = document.querySelector<HTMLButtonElement>('#import-json-btn')!
const importSelectorsInput = document.querySelector<HTMLInputElement>('#import-selectors-input')!

const selectionScript = `
(function() {
  var isSelecting = false;
  var targetType = '';
  var activeParent = null;
  var hlStyle = document.createElement('style');
  hlStyle.textContent = '.hl-show { background-color: rgba(170,59,255,0.25) !important; outline: 2px solid #aa3bff !important; outline-offset: 1px !important; }';
  document.head.appendChild(hlStyle);
  var storedSelectors = [];
  var infoPanel = document.createElement('div');
  infoPanel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(17,17,27,0.93);color:#e2e8f0;padding:5px 14px;font:12px/1.5 monospace;z-index:9999999;display:none;align-items:center;gap:10px;border-top:2px solid #aa3bff;white-space:nowrap;overflow:hidden;pointer-events:none;';
  document.body.appendChild(infoPanel);
  function buildStoredCSS(item) {
    var sel = item.selector;
    (item.parameters || []).forEach(function(p) {
      if (p.key && p.type && p.value) {
        if (p.type === 'contains') sel += '['+p.key+'*="'+p.value+'"]';
        else if (p.type === 'exact') sel += '['+p.key+'="'+p.value+'"]';
        else if (p.type === 'starts') sel += '['+p.key+'^="'+p.value+'"]';
        else if (p.type === 'ends') sel += '['+p.key+'$="'+p.value+'"]';
      }
    });
    return sel;
  }
  function findKeyForEl(el, items) {
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      try { if (item.key && el.matches(buildStoredCSS(item))) return item.key; } catch(e) {}
      var subs = item.sub_selectors && item.sub_selectors.selectors;
      if (subs && subs.length) { var k = findKeyForEl(el, subs); if (k) return k; }
    }
    return '';
  }
  function showInfoPanel(el) {
    var sel = generateSelector(el);
    var key = findKeyForEl(el, storedSelectors);
    infoPanel.innerHTML =
      '<span style="color:#64748b">selector:</span> <span>' + sel + '</span>' +
      (key ? '  <span style="color:#64748b">key:</span> <span style="color:#c084fc;font-weight:bold">' + key + '</span>' : '');
    infoPanel.style.display = 'flex';
  }
  function generateSelector(el) {
    if (el.id) return '#' + el.id;
    var path = [];
    var current = el;
    while (current && current !== document.documentElement) {
      var selector = current.tagName.toLowerCase();
      if (current.id) { selector = '#' + current.id; path.unshift(selector); break; }
      if (current.className && typeof current.className === 'string') {
        var classes = current.className.trim().split(/\\s+/).filter(function(c) { return c; });
        if (classes.length > 0) selector += '.' + classes.join('.');
      }
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === current.tagName; });
        if (siblings.length > 1) {
          var index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(' > ');
  }
  function getTargetEl(el) {
    if (!targetType) return el;
    var current = el;
    var upperType = targetType.toUpperCase();
    while (current && current.tagName !== upperType) {
      if (!current.parentElement || current === document.documentElement) return el;
      current = current.parentElement;
    }
    return current;
  }
  function setHighlight(el, color) {
    el.style.boxShadow = '0 0 0 2px ' + color + ', 0 0 0 4px ' + color + ', 0 0 0 6px ' + color;
    el.style.position = 'relative';
    el.style.zIndex = '999999';
  }
  function clearHighlight(el) {
    el.style.boxShadow = '';
    el.style.position = '';
    el.style.zIndex = '';
  }
  function clearAllHighlights() {
    var all = document.querySelectorAll('*');
    all.forEach(function(el) { clearHighlight(el); });
    document.querySelectorAll('.hl-show').forEach(function(el) { el.classList.remove('hl-show'); });
  }
  function buildFullSelector(item, isSub) {
    var sel = item.selector;
    if (isSub) sel = ' ' + sel;
    if (item.parameters && item.parameters.length > 0) {
      item.parameters.forEach(function(param) {
        if (param.key && param.type && param.value) {
          if (param.type === 'contains') sel += '[' + param.key + '*="' + param.value + '"]';
          else if (param.type === 'exact') sel += '[' + param.key + '="' + param.value + '"]';
          else if (param.type === 'starts') sel += '[' + param.key + '^="' + param.value + '"]';
          else if (param.type === 'ends') sel += '[' + param.key + '$="' + param.value + '"]';
        }
      });
    }
    return sel;
  }
  function flattenSelectors(items, results, path) {
    items.forEach(function(item) {
      var fullPath = path ? path + buildFullSelector(item, true) : buildFullSelector(item, false);
      results.push(fullPath);
      if (item.sub_selectors && item.sub_selectors.selectors) {
        flattenSelectors(item.sub_selectors.selectors, results, fullPath);
      }
    });
  }
  function highlightElements(items) {
    clearAllHighlights();
    var fullSelectors = [];
    flattenSelectors(items, fullSelectors, '');
    fullSelectors.forEach(function(sel) {
      try {
        document.querySelectorAll(sel).forEach(function(el) { el.classList.add('hl-show'); });
      } catch(err) {}
    });
  }
  function highlightParent(path) {
    clearAllHighlights();
    if (!path) return;
    const cssPath = path.replace(/\|\|/g, ' ')
    try {
      var el = document.querySelector(cssPath);
      if (el) setHighlight(el, '#44ff44');
    } catch(err) {}
  }
  document.addEventListener('mouseover', function(e) {
    if (!isSelecting) return;
    var target = getTargetEl(e.target);
    setHighlight(target, '#aa3bff');
    showInfoPanel(target);
  });
  document.addEventListener('mouseout', function(e) {
    if (!isSelecting) return;
    var target = getTargetEl(e.target);
    clearHighlight(target);
  });
  document.addEventListener('click', function(e) {
    if (!isSelecting) return;
    e.preventDefault();
    e.stopPropagation();
    var target = getTargetEl(e.target);
    clearHighlight(target);
    var selector = generateSelector(target);
    window.parent.postMessage({ type: 'element-selected', selector: selector }, '*');
  });
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'toggle-select') {
      isSelecting = e.data.enabled;
      if (!isSelecting) infoPanel.style.display = 'none';
    }
    if (e.data && e.data.type === 'set-selectors') storedSelectors = e.data.selectors || [];
  });
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'set-type') targetType = e.data.elementType || '';
  });
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'highlight') highlightElements(e.data.selectors || []);
    if (e.data && e.data.type === 'clear-highlight') clearAllHighlights();
    if (e.data && e.data.type === 'set-parent') {
      activeParent = e.data.path;
      highlightParent(activeParent);
    }
    if (e.data && e.data.type === 'clear-parent') {
      activeParent = null;
      clearAllHighlights();
    }
  });
})();
`

function loadHtmlContent(htmlContent: string) {
  const blob = new Blob([htmlContent], { type: 'text/html' })
  currentSrc = URL.createObjectURL(blob)

  selectedSelectors.length = 0
  clearActiveParent()
  updateSelectorsList()

  const iframe = document.createElement('iframe')
  iframe.id = 'preview-iframe'
  iframe.src = currentSrc

  document.querySelector<HTMLDivElement>('#frame')!.innerHTML = ''
  document.querySelector<HTMLDivElement>('#frame')!.appendChild(iframe)

  selectBtn.disabled = false
  saveBtn.disabled = true

  iframe.onload = () => {
    try {
      const script = iframe.contentDocument!.createElement('script')
      script.textContent = selectionScript
      iframe.contentDocument!.body.appendChild(script)

      const typeValue = elementType.value
      if (typeValue) {
        iframe.contentWindow!.postMessage({ type: 'set-type', elementType: typeValue }, '*')
      }
    } catch (e) {
      console.error('Cannot inject script:', e)
    }
  }
}

async function loadSelectorsFromDB(templateId: number): Promise<void> {
  try {
    const res = await fetch(`/api/selectors?template_id=${templateId}`)
    const { selectors: flat, parameters } = await res.json()

    const paramsBySelector = new Map<number, SelectorParam[]>()
    for (const p of parameters) {
      if (!paramsBySelector.has(p.selector_id)) paramsBySelector.set(p.selector_id, [])
      paramsBySelector.get(p.selector_id)!.push({ key: p.key, type: p.type, value: p.value, dbId: p.id })
    }

    const nodeMap = new Map<number, SelectorData>()
    for (const s of flat) {
      nodeMap.set(s.id, {
        dbId: s.id,
        type: s.type,
        key: s.key,
        selector: s.selector,
        parameters: paramsBySelector.get(s.id) ?? [],
        sub_selectors: { selectors: [] }
      })
    }

    const roots: SelectorData[] = []
    for (const s of flat) {
      const node = nodeMap.get(s.id)!
      if (s.parent_id === null) {
        roots.push(node)
      } else {
        const parent = nodeMap.get(s.parent_id)
        if (parent) parent.sub_selectors!.selectors.push(node)
      }
    }

    selectedSelectors.length = 0
    selectedSelectors.push(...roots)
    updateSelectorsList()
  } catch (e) {
    console.error('Failed to load selectors:', e)
  }
}

async function persistSelectorToDB(item: SelectorData, parentDbId?: number): Promise<void> {
  try {
    const res = await fetch('/api/selectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: item.type,
        key: item.key,
        selector: item.selector,
        parent_id: parentDbId ?? null,
        template_id: currentTemplateId
      })
    })
    const { id } = await res.json()
    item.dbId = id
  } catch (e) {
    console.error('Failed to save selector:', e)
  }
}


async function loadProjects() {
  try {
    const res = await fetch('/api/templates')
    const templates: { id: number; name: string }[] = await res.json()
    const current = projectSelect.value
    projectSelect.innerHTML = '<option value="">-- Виберіть проект --</option>'
    templates.forEach(t => {
      const opt = document.createElement('option')
      opt.value = String(t.id)
      opt.textContent = t.name
      projectSelect.appendChild(opt)
    })
    if (current && templates.some(t => String(t.id) === current)) {
      projectSelect.value = current
    }
  } catch (e) {
    console.error('Failed to load projects:', e)
  }
}

projectSelect.addEventListener('change', async () => {
  const id = projectSelect.value
  if (!id) return
  currentTemplateId = parseInt(id)
  try {
    const res = await fetch(`/api/templates/${id}`)
    const data: { id: number; name: string; template: string; function_name: string } = await res.json()
    templateNameInput.value = data.name
    templateNameInput.disabled = false
    functionNameInput.value = data.function_name || 'GetHTMLTemplate'
    deleteTemplateBtn.disabled = false
    exportSelectorsBtn.disabled = false
    importSelectorsBtn.disabled = false
    loadHtmlContent(data.template)
    await loadSelectorsFromDB(currentTemplateId)
  } catch (e) {
    console.error('Failed to load project template:', e)
  }
})

fileInput.addEventListener('change', async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) {
    const htmlContent = await file.text()

    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, template: htmlContent })
      })
      const { id } = await res.json()
      currentTemplateId = id
      await loadProjects()
      projectSelect.value = String(id)
      templateNameInput.value = file.name
      templateNameInput.disabled = false
      deleteTemplateBtn.disabled = false
      exportSelectorsBtn.disabled = false
      importSelectorsBtn.disabled = false
    } catch (e) {
      console.error('Failed to save template:', e)
    }

    loadHtmlContent(htmlContent)
  }
})

templateNameInput.addEventListener('change', async () => {
  if (!currentTemplateId) return
  const newName = templateNameInput.value.trim()
  if (!newName) return
  try {
    await fetch(`/api/templates/${currentTemplateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    })
    await loadProjects()
    projectSelect.value = String(currentTemplateId)
  } catch (e) {
    console.error('Failed to update template name:', e)
  }
})

functionNameInput.addEventListener('change', async () => {
  if (!currentTemplateId) return
  const value = functionNameInput.value.trim() || 'GetHTMLTemplate'
  try {
    await fetch(`/api/templates/${currentTemplateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ function_name: value })
    })
  } catch (e) {
    console.error('Failed to update function name:', e)
  }
})

deleteTemplateBtn.addEventListener('click', async () => {
  if (!currentTemplateId) return
  const name = templateNameInput.value || 'цей шаблон'
  if (!confirm(`Видалити "${name}" разом з усіма селекторами?`)) return
  try {
    await fetch(`/api/templates/${currentTemplateId}`, { method: 'DELETE' })
    currentTemplateId = null
    selectedSelectors.length = 0
    clearActiveParent()
    templateNameInput.value = ''
    templateNameInput.disabled = true
    functionNameInput.value = 'GetHTMLTemplate'
    deleteTemplateBtn.disabled = true
    exportSelectorsBtn.disabled = true
    importSelectorsBtn.disabled = true
    selectBtn.disabled = true
    document.querySelector<HTMLDivElement>('#frame')!.innerHTML = '<div class="placeholder">Select an HTML file to preview</div>'
    updateSelectorsList()
    await loadProjects()
  } catch (e) {
    console.error('Failed to delete template:', e)
  }
})

exportSelectorsBtn.addEventListener('click', () => {
  const data = { selectors: selectedSelectors }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = (templateNameInput.value || 'selectors') + '.json'
  a.click()
  URL.revokeObjectURL(url)
})

importSelectorsBtn.addEventListener('click', () => {
  importSelectorsInput.value = ''
  importSelectorsInput.click()
})

async function persistImportedSelectorTree(item: SelectorData, parentDbId?: number): Promise<void> {
  const res = await fetch('/api/selectors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: item.type, key: item.key, selector: item.selector, parent_id: parentDbId ?? null, template_id: currentTemplateId })
  })
  const { id } = await res.json()
  item.dbId = id
  for (const param of item.parameters) {
    const pr = await fetch('/api/parameters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: param.key, type: param.type, value: param.value, selector_id: id })
    })
    param.dbId = (await pr.json()).id
  }
  for (const child of item.sub_selectors?.selectors ?? []) {
    await persistImportedSelectorTree(child, id)
  }
}

importSelectorsInput.addEventListener('change', async (event) => {
  if (!currentTemplateId) return
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    if (!data.selectors || !Array.isArray(data.selectors)) return
    if (selectedSelectors.length > 0 && !confirm('Замінити поточні селектори імпортованими?')) return
    for (const item of selectedSelectors) {
      if (item.dbId) await fetch(`/api/selectors/${item.dbId}`, { method: 'DELETE' })
    }
    selectedSelectors.length = 0
    clearActiveParent()
    const imported: SelectorData[] = data.selectors.map((s: SelectorData) => stripDbIds(s))
    for (const item of imported) {
      selectedSelectors.push(item)
      await persistImportedSelectorTree(item)
    }
    updateSelectorsList()
  } catch (e) {
    console.error('Failed to import selectors:', e)
  }
})

function stripDbIds(item: SelectorData): SelectorData {
  return {
    type: item.type ?? '',
    key: item.key ?? '',
    selector: item.selector ?? '',
    parameters: (item.parameters ?? []).map((p: SelectorParam) => ({ key: p.key, type: p.type, value: p.value })),
    sub_selectors: { selectors: (item.sub_selectors?.selectors ?? []).map(stripDbIds) }
  }
}

elementType.addEventListener('change', () => {
  const typeValue = elementType.value
  const iframe = document.querySelector<HTMLIFrameElement>('#preview-iframe')
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'set-type', elementType: typeValue }, '*')
  }
})

selectBtn.addEventListener('click', () => {
  isSelecting = !isSelecting
  selectBtn.textContent = isSelecting ? 'Done Selecting' : 'Select Elements'
  selectBtn.classList.toggle('active', isSelecting)
  
  const iframe = document.querySelector<HTMLIFrameElement>('#preview-iframe')
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'toggle-select', enabled: isSelecting }, '*')
    if (isSelecting) {
      iframe.contentWindow.postMessage({ type: 'set-selectors', selectors: selectedSelectors }, '*')
    }
  }
})

showBtn.addEventListener('click', () => {
  isShowing = !isShowing
  showBtn.textContent = isShowing ? 'Hide Elements' : 'Show Elements'
  showBtn.classList.toggle('active', isShowing)
  
  const iframe = document.querySelector<HTMLIFrameElement>('#preview-iframe')
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ 
      type: isShowing ? 'highlight' : 'clear-highlight', 
      selectors: selectedSelectors 
    }, '*')
  }
})

saveBtn.addEventListener('click', () => {
  if (selectedSelectors.length === 0) return
  const data = { selectors: selectedSelectors }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'selectors.json'
  a.click()
  URL.revokeObjectURL(url)
})

loadBtn.addEventListener('click', () => {
  loadInput.click()
})

loadInput.addEventListener('change', async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    if (data.selectors && Array.isArray(data.selectors)) {
      selectedSelectors.length = 0
      selectedSelectors.push(...data.selectors)
      clearActiveParent()
      updateSelectorsList()
      showBtn.disabled = selectedSelectors.length === 0
    }
  } catch (e) {
    console.error('Failed to load selectors:', e)
  }
  loadInput.value = ''
})

document.querySelectorAll<HTMLButtonElement>('.page-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    document.body.dataset.page = tab.dataset.page!
  })
})

document.querySelector<HTMLButtonElement>('#generate-result-btn')?.addEventListener('click', async () => {
  const codeEl = document.querySelector<HTMLTextAreaElement>('#result-code')
  const btn = document.querySelector<HTMLButtonElement>('#generate-result-btn')!
  if (!codeEl) return
  btn.disabled = true
  btn.textContent = 'Генерація...'
  const templateName = projectSelect.options[projectSelect.selectedIndex]?.text ?? 'Template'
  const createFunction = (document.querySelector<HTMLInputElement>('#create-function-cb')?.checked) ?? true
  const functionName = functionNameInput.value.trim() || 'GetHTMLTemplate'
  codeEl.value = await generateResultCode(currentTemplateId, selectedSelectors, templateName, createFunction, functionName)
  btn.disabled = false
  btn.textContent = 'Generate'
})

document.querySelector<HTMLButtonElement>('#copy-result-btn')?.addEventListener('click', async () => {
  const el = document.querySelector<HTMLTextAreaElement>('#result-code')
  if (!el) return
  await navigator.clipboard.writeText(el.value)
  const btn = document.querySelector<HTMLButtonElement>('#copy-result-btn')!
  const prev = btn.textContent
  btn.textContent = 'Скопійовано!'
  setTimeout(() => { btn.textContent = prev }, 1500)
})

initSelectorEdit({
  selectedSelectors,
  selectorsList,
  parentInfo,
  showBtn,
  saveBtn,
  getElementType: () => elementType.value,
  persistSelectorToDB,
  getCurrentTemplateId: () => currentTemplateId,
})

updateSelectorsList()
loadProjects()