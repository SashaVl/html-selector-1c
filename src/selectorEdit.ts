import type { SelectorData, SelectorParam } from './generateCode1c'

interface SelectorEditContext {
  selectedSelectors: SelectorData[]
  selectorsList: HTMLDivElement
  parentInfo: HTMLDivElement
  showBtn: HTMLButtonElement
  saveBtn: HTMLButtonElement
  getElementType: () => string
  persistSelectorToDB: (item: SelectorData, parentDbId?: number) => Promise<void>
  getCurrentTemplateId: () => number | null
}

let ctx: SelectorEditContext
let activeParentPath: string | null = null

// ── DB helpers ────────────────────────────────────────────────────────────────

function updateSelectorInDB(item: SelectorData): void {
  if (!item.dbId) return
  fetch(`/api/selectors/${item.dbId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: item.type, key: item.key, selector: item.selector })
  }).catch(e => console.error('Failed to update selector:', e))
}

function deleteSelectorFromDB(item: SelectorData): void {
  if (!item.dbId) return
  fetch(`/api/selectors/${item.dbId}`, { method: 'DELETE' })
    .catch(e => console.error('Failed to delete selector:', e))
}

async function persistParamToDB(param: SelectorParam, selectorDbId: number): Promise<void> {
  try {
    const res = await fetch('/api/parameters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: param.key, type: param.type, value: param.value, selector_id: selectorDbId })
    })
    const { id } = await res.json()
    param.dbId = id
  } catch (e) {
    console.error('Failed to save parameter:', e)
  }
}

function updateParamInDB(param: SelectorParam): void {
  if (!param.dbId) return
  fetch(`/api/parameters/${param.dbId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: param.key, type: param.type, value: param.value })
  }).catch(e => console.error('Failed to update parameter:', e))
}

function deleteParamFromDB(param: SelectorParam): void {
  if (!param.dbId) return
  fetch(`/api/parameters/${param.dbId}`, { method: 'DELETE' })
    .catch(e => console.error('Failed to delete parameter:', e))
}

// ── Parent path helpers ───────────────────────────────────────────────────────

export function updateParentInfo(): void {
  if (activeParentPath) {
    const displayPath = activeParentPath.replace(/\|\|/g, ' > ')
    ctx.parentInfo.style.display = 'block'
    ctx.parentInfo.innerHTML =
      '<span>Adding to: <strong>' + displayPath + '</strong></span>' +
      '<button id="cancel-parent">Cancel</button>'
    document.querySelector<HTMLButtonElement>('#cancel-parent')
      ?.addEventListener('click', clearActiveParent)
  } else {
    ctx.parentInfo.style.display = 'none'
  }
}

export function clearActiveParent(): void {
  activeParentPath = null
  updateParentInfo()
  const iframe = document.querySelector<HTMLIFrameElement>('#preview-iframe')
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'clear-parent' }, '*')
  }
}

function highlightActiveParent(): void {
  const iframe = document.querySelector<HTMLIFrameElement>('#preview-iframe')
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'set-parent', path: activeParentPath }, '*')
  }
}

// ── Selector tree helpers ─────────────────────────────────────────────────────

function buildFullPath(mainIndex: number, subIndex?: number): string {
  let path = ctx.selectedSelectors[mainIndex].selector
  if (subIndex !== undefined) {
    path = path + '||' + ctx.selectedSelectors[mainIndex].sub_selectors!.selectors[subIndex].selector
  }
  return path
}

function findAndAddSub(
  parentPath: string,
  newSelector: string
): { newItem: SelectorData; parentDbId: number | undefined } | null {
  const parts = parentPath.split('||')

  function search(
    items: SelectorData[],
    depth: number
  ): { newItem: SelectorData; parentDbId: number | undefined } | null {
    const targetSelector = parts[depth]
    for (const item of items) {
      if (item.selector === targetSelector) {
        if (depth === parts.length - 1) {
          if (!item.sub_selectors) item.sub_selectors = { selectors: [] }
          const exists = item.sub_selectors.selectors.some(sub => sub.selector === newSelector)
          if (exists) return null
          const newItem: SelectorData = {
            type: '', key: '', selector: newSelector,
            parameters: [], sub_selectors: { selectors: [] }
          }
          item.sub_selectors.selectors.push(newItem)
          return { newItem, parentDbId: item.dbId }
        }
        if (item.sub_selectors) {
          const result = search(item.sub_selectors.selectors, depth + 1)
          if (result) return result
        }
      }
    }
    return null
  }
  return search(ctx.selectedSelectors, 0)
}

// ── Import helpers ────────────────────────────────────────────────────────────

function buildSelectorCSS(item: SelectorData): string {
  let sel = item.selector
  for (const p of item.parameters) {
    if (p.key && p.type && p.value) {
      if (p.type === 'contains') sel += `[${p.key}*="${p.value}"]`
      else if (p.type === 'exact') sel += `[${p.key}="${p.value}"]`
      else if (p.type === 'starts') sel += `[${p.key}^="${p.value}"]`
      else if (p.type === 'ends') sel += `[${p.key}$="${p.value}"]`
    }
  }
  return sel
}

function filterSelectorTree(items: SelectorData[], doc: Document): SelectorData[] {
  const result: SelectorData[] = []
  for (const item of items) {
    const css = buildSelectorCSS(item)
    let found = false
    try { found = !!doc.querySelector(css) } catch (_) {}
    if (found) {
      const filteredChildren = item.sub_selectors?.selectors?.length
        ? filterSelectorTree(item.sub_selectors.selectors, doc)
        : []
      result.push({
        type: item.type,
        key: item.key,
        selector: item.selector,
        parameters: item.parameters.map(p => ({ key: p.key, type: p.type, value: p.value })),
        sub_selectors: { selectors: filteredChildren }
      })
    }
  }
  return result
}

async function persistImportTree(
  items: SelectorData[],
  parentSd: SelectorData | null,
  parentDbId: number | undefined
): Promise<void> {
  for (const item of items) {
    if (parentSd === null) {
      ctx.selectedSelectors.push(item)
    } else {
      parentSd.sub_selectors!.selectors.push(item)
    }
    await ctx.persistSelectorToDB(item, parentDbId)
    for (const param of item.parameters) {
      if (item.dbId) await persistParamToDB(param, item.dbId)
    }
    if (item.sub_selectors?.selectors?.length) {
      const children = [...item.sub_selectors.selectors]
      item.sub_selectors.selectors = []
      await persistImportTree(children, item, item.dbId)
    }
  }
}

async function importSelectorsFromTemplate(sourceId: number): Promise<void> {
  const currentId = ctx.getCurrentTemplateId()
  if (!currentId) return
  try {
    const [srcRes, tmplRes] = await Promise.all([
      fetch(`/api/selectors?template_id=${sourceId}`),
      fetch(`/api/templates/${currentId}`)
    ])
    const { selectors: flat, parameters } = await srcRes.json()
    const { template: htmlContent } = await tmplRes.json()
    const doc = new DOMParser().parseFromString(htmlContent, 'text/html')

    const paramsBySelector = new Map<number, SelectorParam[]>()
    for (const p of parameters) {
      if (!paramsBySelector.has(p.selector_id)) paramsBySelector.set(p.selector_id, [])
      paramsBySelector.get(p.selector_id)!.push({ key: p.key, type: p.type, value: p.value })
    }

    const nodeMap = new Map<number, SelectorData>()
    for (const s of flat) {
      nodeMap.set(s.id, {
        type: s.type, key: s.key, selector: s.selector,
        parameters: paramsBySelector.get(s.id) ?? [],
        sub_selectors: { selectors: [] }
      })
    }
    const roots: SelectorData[] = []
    for (const s of flat) {
      const node = nodeMap.get(s.id)!
      if (s.parent_id === null) { roots.push(node) }
      else { nodeMap.get(s.parent_id)?.sub_selectors?.selectors.push(node) }
    }

    const filtered = filterSelectorTree(roots, doc)
    if (filtered.length > 0) {
      await persistImportTree(filtered, null, undefined)
    }
    updateSelectorsList()
  } catch (e) {
    console.error('Failed to import selectors:', e)
  }
}

async function showImportModal(): Promise<void> {
  const currentId = ctx.getCurrentTemplateId()
  if (!currentId) return
  try {
    const res = await fetch('/api/templates')
    const templates: { id: number; name: string }[] = await res.json()
    const others = templates.filter(t => t.id !== currentId)
    if (others.length === 0) return

    const modal = document.createElement('div')
    modal.className = 'modal'
    modal.innerHTML =
      '<div class="modal-content">' +
        '<h3>Import Selectors</h3>' +
        '<p>Choose a template — only selectors found in the current HTML will be copied.</p>' +
        '<div class="modal-buttons">' +
          '<button class="select-btn cancel" id="import-modal-cancel">Cancel</button>' +
        '</div>' +
        '<div class="sub-selector-list">' +
          others.map(t => `<button class="select-btn sub-select-btn" data-id="${t.id}">${t.name}</button>`).join('') +
        '</div>' +
      '</div>'
    document.body.appendChild(modal)

    modal.querySelector('#import-modal-cancel')?.addEventListener('click', () => modal.remove())
    modal.addEventListener('click', async (e) => {
      if (e.target === modal) { modal.remove(); return }
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')
      if (!btn) return
      const sourceId = parseInt(btn.dataset.id!)
      modal.remove()
      await importSelectorsFromTemplate(sourceId)
    })
  } catch (e) {
    console.error('Failed to show import modal:', e)
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderSubSelectorsRecursive(selectors: SelectorData[], mainIndex: number): string {
  return selectors.map((item, index) => {
    const paramsHtml = item.parameters.map((param, pIndex) =>
      '<div class="param-row small">' +
        '<input class="param-input small" data-main="' + mainIndex + '" data-sub="' + index + '" data-param="' + pIndex + '" data-field="key" value="' + param.key + '" placeholder="key" />' +
        '<select class="param-select small" data-main="' + mainIndex + '" data-sub="' + index + '" data-param="' + pIndex + '" data-field="type">' +
          '<option value="" ' + (param.type === '' ? 'selected' : '') + '>any</option>' +
          '<option value="contains" ' + (param.type === 'contains' ? 'selected' : '') + '>contains</option>' +
          '<option value="exact" ' + (param.type === 'exact' ? 'selected' : '') + '>exact</option>' +
          '<option value="starts" ' + (param.type === 'starts' ? 'selected' : '') + '>starts</option>' +
          '<option value="ends" ' + (param.type === 'ends' ? 'selected' : '') + '>ends</option>' +
        '</select>' +
        '<input class="param-input small" data-main="' + mainIndex + '" data-sub="' + index + '" data-param="' + pIndex + '" data-field="value" value="' + param.value + '" placeholder="value" />' +
        '<button class="remove-param-btn-small" data-main="' + mainIndex + '" data-sub="' + index + '" data-param="' + pIndex + '">×</button>' +
      '</div>'
    ).join('')

    let subHtml = ''
    if (item.sub_selectors?.selectors?.length) {
      subHtml = '<div class="nested-sub">' + renderSubSelectorsRecursive(item.sub_selectors.selectors, mainIndex) + '</div>'
    }

    return '<div class="sub-selector-item">' +
      '<div class="selector-main small">' +
        '<input class="selector-input small meta-input" data-main="' + mainIndex + '" data-sub="' + index + '" data-field="type" value="' + item.type + '" placeholder="type" />' +
        '<input class="selector-input small meta-input" data-main="' + mainIndex + '" data-sub="' + index + '" data-field="key" value="' + item.key + '" placeholder="key" />' +
        '<input class="selector-input small" data-main="' + mainIndex + '" data-sub="' + index + '" value="' + item.selector + '" placeholder="selector" />' +
        '<button class="add-param-btn-small" data-main="' + mainIndex + '" data-sub="' + index + '">+</button>' +
        '<button class="select-sub-parent-btn" data-main="' + mainIndex + '" data-sub="' + index + '">+ sub</button>' +
        '<button class="remove-sub-btn" data-main="' + mainIndex + '" data-sub="' + index + '">×</button>' +
      '</div>' +
      '<div class="params-container small">' + paramsHtml + '</div>' +
      subHtml +
    '</div>'
  }).join('')
}

export function updateSelectorsList(): void {
  const { selectedSelectors, selectorsList, showBtn, saveBtn } = ctx

  if (selectedSelectors.length === 0) {
    const templateId = ctx.getCurrentTemplateId()
    selectorsList.innerHTML =
      '<div class="placeholder-text">Select elements to see their selectors</div>' +
      (templateId ? '<div style="text-align:center;margin-top:12px"><button id="import-selectors-btn" class="select-btn">Import Selectors</button></div>' : '')
    if (templateId) {
      document.querySelector<HTMLButtonElement>('#import-selectors-btn')
        ?.addEventListener('click', showImportModal)
    }
    showBtn.disabled = true
    saveBtn.disabled = true
    return
  }

  showBtn.disabled = false
  saveBtn.disabled = false

  selectorsList.innerHTML = selectedSelectors.map((item, index) => {
    const paramsHtml = item.parameters.map((param, pIndex) =>
      '<div class="param-row">' +
        '<input class="param-input" data-main="' + index + '" data-param="' + pIndex + '" data-field="key" value="' + param.key + '" placeholder="key" />' +
        '<select class="param-select" data-main="' + index + '" data-param="' + pIndex + '" data-field="type">' +
          '<option value="" ' + (param.type === '' ? 'selected' : '') + '>any</option>' +
          '<option value="contains" ' + (param.type === 'contains' ? 'selected' : '') + '>contains</option>' +
          '<option value="exact" ' + (param.type === 'exact' ? 'selected' : '') + '>exact</option>' +
          '<option value="starts" ' + (param.type === 'starts' ? 'selected' : '') + '>starts</option>' +
          '<option value="ends" ' + (param.type === 'ends' ? 'selected' : '') + '>ends</option>' +
        '</select>' +
        '<input class="param-input" data-main="' + index + '" data-param="' + pIndex + '" data-field="value" value="' + param.value + '" placeholder="value" />' +
        '<button class="remove-param-btn" data-main="' + index + '" data-param="' + pIndex + '">×</button>' +
      '</div>'
    ).join('')

    let subSelectorsHtml = ''
    if (item.sub_selectors?.selectors?.length) {
      subSelectorsHtml = '<div class="sub-selectors-container">' + renderSubSelectorsRecursive(item.sub_selectors.selectors, index) + '</div>'
    }

    const isActive = activeParentPath === item.selector
    return '<div class="selector-item' + (isActive ? ' active-parent' : '') + '" data-main="' + index + '">' +
      '<div class="selector-main">' +
        '<input class="selector-input meta-input" data-main="' + index + '" data-field="type" value="' + item.type + '" placeholder="type" />' +
        '<input class="selector-input meta-input" data-main="' + index + '" data-field="key" value="' + item.key + '" placeholder="key" />' +
        '<input class="selector-input" data-main="' + index + '" value="' + item.selector + '" placeholder="selector" />' +
        '<button class="add-param-btn" data-main="' + index + '">+ param</button>' +
        '<button class="add-sub-btn" data-main="' + index + '">+ sub</button>' +
        '<button class="remove-main-btn" data-main="' + index + '">×</button>' +
      '</div>' +
      '<div class="params-container">' + paramsHtml + '</div>' +
      subSelectorsHtml +
    '</div>'
  }).join('')

  selectorsList.querySelectorAll('.selector-input, .param-input, .param-select').forEach(input => {
    input.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement
      if (target.dataset.sub !== undefined) return
      const mainIndex = parseInt(target.dataset.main!)
      const field = target.dataset.field!
      const paramIndex = target.dataset.param !== undefined ? parseInt(target.dataset.param) : -1

      if (paramIndex >= 0) {
        const param = selectedSelectors[mainIndex].parameters[paramIndex]
        if (field === 'key') param.key = target.value
        else if (field === 'type') param.type = target.value
        else if (field === 'value') param.value = target.value
        updateParamInDB(param)
      } else if (field === 'type' || field === 'key') {
        (selectedSelectors[mainIndex] as any)[field] = target.value
        updateSelectorInDB(selectedSelectors[mainIndex])
      } else if (field === 'selector' || !field) {
        const oldSelector = selectedSelectors[mainIndex].selector
        selectedSelectors[mainIndex].selector = (target as HTMLInputElement).value
        if (activeParentPath === oldSelector) {
          activeParentPath = selectedSelectors[mainIndex].selector
          updateParentInfo()
          highlightActiveParent()
        }
        updateSelectorInDB(selectedSelectors[mainIndex])
      }
    })
  })

  selectorsList.querySelectorAll('.remove-main-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const mainIndex = parseInt((e.target as HTMLElement).dataset.main!)
      if (activeParentPath === selectedSelectors[mainIndex].selector) clearActiveParent()
      deleteSelectorFromDB(selectedSelectors[mainIndex])
      selectedSelectors.splice(mainIndex, 1)
      updateSelectorsList()
    })
  })

  selectorsList.querySelectorAll('.add-param-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const mainIndex = parseInt((e.target as HTMLElement).dataset.main!)
      const newParam: SelectorParam = { key: '', type: '', value: '' }
      selectedSelectors[mainIndex].parameters.push(newParam)
      const selectorDbId = selectedSelectors[mainIndex].dbId
      if (selectorDbId) await persistParamToDB(newParam, selectorDbId)
      updateSelectorsList()
    })
  })

  selectorsList.querySelectorAll('.remove-param-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const mainIndex = parseInt((e.target as HTMLElement).dataset.main!)
      const paramIndex = parseInt((e.target as HTMLElement).dataset.param!)
      deleteParamFromDB(selectedSelectors[mainIndex].parameters[paramIndex])
      selectedSelectors[mainIndex].parameters.splice(paramIndex, 1)
      updateSelectorsList()
    })
  })

  selectorsList.querySelectorAll('.add-sub-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const mainIndex = parseInt((e.target as HTMLElement).dataset.main!)
      activeParentPath = selectedSelectors[mainIndex].selector
      updateParentInfo()
      highlightActiveParent()
    })
  })
}

// ── Event delegation ──────────────────────────────────────────────────────────

function attachDelegatedListeners(): void {
  const { selectorsList, selectedSelectors } = ctx

  selectorsList.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement

    if (target.classList.contains('add-param-btn-small')) {
      const mainIndex = parseInt(target.dataset.main!)
      const subIndex = parseInt(target.dataset.sub!)
      const subItem = selectedSelectors[mainIndex].sub_selectors!.selectors[subIndex]
      const newParam: SelectorParam = { key: '', type: '', value: '' }
      subItem.parameters.push(newParam)
      if (subItem.dbId) await persistParamToDB(newParam, subItem.dbId)
      updateSelectorsList()
    }

    if (target.classList.contains('remove-param-btn-small')) {
      const mainIndex = parseInt(target.dataset.main!)
      const subIndex = parseInt(target.dataset.sub!)
      const paramIndex = parseInt(target.dataset.param!)
      const subItem = selectedSelectors[mainIndex].sub_selectors!.selectors[subIndex]
      deleteParamFromDB(subItem.parameters[paramIndex])
      subItem.parameters.splice(paramIndex, 1)
      updateSelectorsList()
    }

    if (target.classList.contains('add-sub-btn-small') || target.classList.contains('select-sub-parent-btn')) {
      const mainIndex = parseInt(target.dataset.main!)
      const subIndex = parseInt(target.dataset.sub!)
      const subSelector = selectedSelectors[mainIndex].sub_selectors!.selectors[subIndex]
      if (!subSelector.sub_selectors) subSelector.sub_selectors = { selectors: [] }
      activeParentPath = buildFullPath(mainIndex, subIndex)
      updateParentInfo()
      highlightActiveParent()
    }

    if (target.classList.contains('remove-sub-btn')) {
      const mainIndex = parseInt(target.dataset.main!)
      const subIndex = parseInt(target.dataset.sub!)
      deleteSelectorFromDB(selectedSelectors[mainIndex].sub_selectors!.selectors[subIndex])
      selectedSelectors[mainIndex].sub_selectors!.selectors.splice(subIndex, 1)
      updateSelectorsList()
    }
  })

  selectorsList.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement
    const mainIndex = parseInt(target.dataset.main || '-1')
    const subIndex = parseInt(target.dataset.sub || '-1')
    const field = target.dataset.field

    if (mainIndex >= 0 && subIndex >= 0) {
      const paramIndex = target.dataset.param !== undefined ? parseInt(target.dataset.param) : -1
      const subItem = selectedSelectors[mainIndex].sub_selectors!.selectors[subIndex]
      if (paramIndex >= 0) {
        const param = subItem.parameters[paramIndex]
        if (field === 'key') param.key = target.value
        else if (field === 'type') param.type = target.value
        else if (field === 'value') param.value = target.value
        updateParamInDB(param)
      } else if (field === 'type' || field === 'key') {
        (subItem as any)[field] = target.value
        updateSelectorInDB(subItem)
      } else if (field === 'selector' || !field) {
        subItem.selector = target.value
        updateSelectorInDB(subItem)
      }
    }
  })

  window.addEventListener('message', async (event) => {
    if (event.data?.type !== 'element-selected') return
    const selector = event.data.selector

    if (activeParentPath) {
      const result = findAndAddSub(activeParentPath, selector)
      if (result) await ctx.persistSelectorToDB(result.newItem, result.parentDbId)
      updateSelectorsList()
      highlightActiveParent()
    } else {
      const exists = selectedSelectors.some(item => item.selector === selector)
      if (!exists) {
        const newItem: SelectorData = {
          type: ctx.getElementType(),
          key: '',
          selector,
          parameters: [],
          sub_selectors: { selectors: [] }
        }
        selectedSelectors.push(newItem)
        await ctx.persistSelectorToDB(newItem)
        updateSelectorsList()
      }
    }
  })
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initSelectorEdit(context: SelectorEditContext): void {
  ctx = context
  attachDelegatedListeners()
}
