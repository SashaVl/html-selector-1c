export interface SelectorParam {
  key: string
  type: string
  value: string
  dbId?: number
}

export interface SelectorData {
  type: string
  key: string
  selector: string
  parameters: SelectorParam[]
  sub_selectors?: { selectors: SelectorData[] }
  dbId?: number
}

interface FlatEntry { cssPath: string; key: string; hasRegisteredSubs: boolean }

function buildFullCSSSelector(item: SelectorData): string {
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

function flattenForCode(items: SelectorData[], parentPath = ''): FlatEntry[] {
  const result: FlatEntry[] = []
  for (const item of items) {
    const sel = buildFullCSSSelector(item)
    const path = parentPath ? `${parentPath} ${sel}` : sel
    const hasRegisteredSubs = !!(item.sub_selectors?.selectors?.length)
    result.push({ cssPath: path, key: item.key || '', hasRegisteredSubs })
    if (hasRegisteredSubs) {
      result.push(...flattenForCode(item.sub_selectors!.selectors, path))
    }
  }
  return result
}

function annotateTableElements(doc: Document, items: SelectorData[], parentPath = ''): void {
  for (const item of items) {
    const sel = buildFullCSSSelector(item)
    const fullPath = parentPath ? `${parentPath} ${sel}` : sel

    if (item.key && item.sub_selectors?.selectors?.length) {
      try {
        const el = doc.querySelector(fullPath)
        if (el && el.tagName.toLowerCase() === 'table') {
          el.setAttribute('data-1c-table-key', item.key)
          const firstBodyRow = el.querySelector(':scope > tbody > tr')
          const searchRoot = firstBodyRow ?? el
          const cellKeys: string[] = []
          for (const sub of item.sub_selectors.selectors) {
            if (sub.key) {
              try {
                const cellEl = searchRoot.querySelector(buildFullCSSSelector(sub))
                if (cellEl) {
                  cellEl.setAttribute('data-1c-cell-key', sub.key)
                  cellKeys.push(sub.key)
                }
              } catch (_) {}
            }
          }
          if (cellKeys.length > 0) {
            el.setAttribute('data-1c-cell-keys', cellKeys.join(','))
          }
        }
      } catch (_) {}
    }

    if (item.sub_selectors?.selectors?.length) {
      annotateTableElements(doc, item.sub_selectors.selectors, fullPath)
    }
  }
}

let _stringKeys = new Set<string>()

function collectStringKeys(items: SelectorData[]): Set<string> {
  const result = new Set<string>()
  for (const item of items) {
    if (item.key && item.type === 'string') result.add(item.key)
    if (item.sub_selectors?.selectors?.length) {
      for (const key of collectStringKeys(item.sub_selectors.selectors)) result.add(key)
    }
  }
  return result
}

function esc(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').replace(/"/g, '""').trim()
}

function toExpr(raw: string): string {
  if (!raw) return '""'
  const parts = raw.split(/\{\{%([^%]+)%\}\}/)
  const chunks = parts
    .map((p, i) => {
      if (i % 2 === 0) return p ? `"${p}"` : null
      const wrapper = _stringKeys.has(p) ? 'String' : 'XMLString'
      return `${wrapper}(tempData.${p})`
    })
    .filter(Boolean) as string[]
  return chunks.length ? chunks.join(' + ') : '""'
}

function addPipePrefix(s: string): string {
  const lines = s.split('\n')
  return lines.map((line, i) => i === 0 ? line : '|' + line).join('\n')
}

function generateElementByElement(node: Node, indent: string): string {
  let result = ''
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? '').replace(/ /g, '&nbsp;').trim()
      if (text) {
        result += `${indent}HTMLText = HTMLText + ${toExpr(text)};\n`
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      result += generateElementCode(child as Element, indent)
    }
  }
  return result
}

function generateElementCode(el: Element, indent: string, tableVarName?: string): string {
  if (el.tagName.toLowerCase() === 'table' && el.hasAttribute('data-1c-table-key')) {
    return generateTableCode(el, indent)
  }

  const tag = el.tagName.toLowerCase()
  const idStr = el.id ? ` id=""${el.id}""` : ''
  const clsStr = el.className ? ` class=""${String(el.className).trim()}""` : ''
  const otherAttrs = Array.from(el.attributes)
    .filter(a => a.name !== 'id' && a.name !== 'class' && !a.name.startsWith('data-1c-'))
    .map(a => ` ${a.name}=""${a.value}""`)
    .join('')

  let result = ''
  result += `${indent}// <${tag}${idStr}${clsStr}>\n`

  const cellKey = tableVarName ? el.getAttribute('data-1c-cell-key') : null
  if (cellKey) {
    result += `${indent}HTMLText = HTMLText + "<${tag}${idStr}${clsStr}${otherAttrs}>" + XMLString(${tableVarName}.${cellKey}) + "</${tag}>";\n\n`
    return result
  }

  result += `${indent}HTMLText = HTMLText + "<${tag}${idStr}${clsStr}${otherAttrs}>";\n`

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? '').replace(/ /g, '&nbsp;').trim().replace(/"/g, '""')
      if (text) {
        result += `${indent}\tHTMLText = HTMLText + ${toExpr(addPipePrefix(text))};\n`
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      result += generateElementCode(child as Element, indent + '\t', tableVarName)
    }
  }

  result += `${indent}HTMLText = HTMLText + "</${tag}>";\n\n`
  return result
}

function generateTableCode(tableEl: Element, indent: string): string {
  const tableKey = tableEl.getAttribute('data-1c-table-key')!
  const varName = `TableRow_${tableKey}`
  const tempVarName = `tempTableRow_${tableKey}`
  const cellKeys = (tableEl.getAttribute('data-1c-cell-keys') ?? '').split(',').filter(Boolean)

  const idStr = tableEl.id ? ` id=""${tableEl.id}""` : ''
  const clsStr = tableEl.className ? ` class=""${String(tableEl.className).trim()}""` : ''
  const otherAttrs = Array.from(tableEl.attributes)
    .filter(a => a.name !== 'id' && a.name !== 'class' && !a.name.startsWith('data-1c-'))
    .map(a => ` ${a.name}=""${a.value}""`)
    .join('')

  let result = ''
  result += `${indent}// <table>\n`
  result += `${indent}HTMLText = HTMLText + "<table${idStr}${clsStr}${otherAttrs}>";\n\n`

  for (const child of Array.from(tableEl.children)) {
    const childTag = child.tagName.toLowerCase()
    if (childTag === 'tbody') {
      result += `${indent}\tHTMLText = HTMLText + "<tbody>";\n`
      result += `${indent}\tFor Each ${varName} In tempData.${tableKey} Do\n`
      if (cellKeys.length > 0) {
        result += `${indent}\t\t${tempVarName} = New Structure("${cellKeys.join(', ')}");\n`
        result += `${indent}\t\tFillPropertyValues(${tempVarName}, ${varName});\n\n`
      }
      const firstRow = child.querySelector(':scope > tr')
      if (firstRow) {
        result += generateTableRowCode(firstRow, indent + '\t\t', cellKeys.length > 0 ? tempVarName : varName)
      }
      result += `${indent}\tEndDo;\n`
      result += `${indent}\tHTMLText = HTMLText + "</tbody>";\n\n`
    } else {
      result += generateElementCode(child, indent + '\t')
    }
  }

  result += `${indent}HTMLText = HTMLText + "</table>";\n\n`
  return result
}

function generateTableRowCode(rowEl: Element, indent: string, varName: string): string {
  const idStr = rowEl.id ? ` id=""${rowEl.id}""` : ''
  const clsStr = rowEl.className ? ` class=""${String(rowEl.className).trim()}""` : ''
  const otherAttrs = Array.from(rowEl.attributes)
    .filter(a => a.name !== 'id' && a.name !== 'class')
    .map(a => ` ${a.name}=""${a.value}""`)
    .join('')

  let result = ''
  result += `${indent}// <tr>\n`
  result += `${indent}HTMLText = HTMLText + "<tr${idStr}${clsStr}${otherAttrs}>";\n`

  for (const cell of Array.from(rowEl.children)) {
    result += generateElementCode(cell, indent + '\t', varName)
  }

  result += `${indent}HTMLText = HTMLText + "</tr>";\n\n`
  return result
}

export async function generateResultCode(
  currentTemplateId: number | null,
  selectedSelectors: SelectorData[],
  templateName: string,
  createFunction = true,
  functionName = 'GetHTMLTemplate'
): Promise<string> {
  if (!currentTemplateId) return '// Select a template (project) first'

  let templateHTML: string
  try {
    const res = await fetch(`/api/templates/${currentTemplateId}`)
    const data = await res.json()
    templateHTML = data.template as string
  } catch {
    return '// Error loading template'
  }

  const doc = new DOMParser().parseFromString(templateHTML, 'text/html')

  const flatKeyed = flattenForCode(selectedSelectors)
    .filter(f => f.key)
    .sort((a, b) => b.cssPath.length - a.cssPath.length)

  console.log('=== Selector Matching ===')
  const found: string[] = []
  const notFound: string[] = []
  const skipped: string[] = []
  for (const f of flatKeyed) {
    try {
      const el = doc.querySelector(f.cssPath)
      if (el) {
        if (!f.hasRegisteredSubs) {
          el.innerHTML = `{{%${f.key}%}}`
          found.push(`${f.key} -> "${f.cssPath}" | <${el.tagName.toLowerCase()}>`)
          console.log(`✓ FOUND: ${f.key} -> "${f.cssPath}" | <${el.tagName.toLowerCase()}>`)
        } else {
          skipped.push(`${f.key} -> "${f.cssPath}"`)
          console.log(`✗ SKIP (has registered subs): ${f.key} -> "${f.cssPath}"`)
        }
      } else {
        notFound.push(`${f.key} -> "${f.cssPath}"`)
        console.log(`✗ NOT FOUND: ${f.key} -> "${f.cssPath}"`)
      }
    } catch (e) {
      console.log(`✗ ERROR: ${f.key} -> "${f.cssPath}" - ${e}`)
    }
  }
  console.log('========================')
  console.log(`Summary: Found: ${found.length}, Not Found: ${notFound.length}, Skipped: ${skipped.length}`)
  if (found.length > 0) console.log('Found selectors:', found)

  annotateTableElements(doc, selectedSelectors)
  _stringKeys = collectStringKeys(selectedSelectors)

  const date = new Date().toLocaleDateString('uk-UA')

  let c = `// ================================================================\n`
  c    += `// Auto-generated\n`
  c    += `// Template : ${templateName}\n`
  c    += `// Date     : ${date}\n`
  c    += `// ================================================================\n\n`

  const indent = '\t'

  if (createFunction) {
    c += `#Region HTMLTemplate\n\n`
    c += `// Builds the HTML page substituting values from Data (Structure key -> value)\n`
    c += `Function ${functionName}(Val Data) Export\n\n`
  }

  const rootKeys = selectedSelectors.filter(s => s.key).map(s => s.key)
  if (rootKeys.length > 0) {
    c += `${indent}tempData = New Structure("${rootKeys.join(', ')}");\n`
    c += `${indent}FillPropertyValues(tempData, Data);\n\n`
  }

  c += `${indent}HTMLText = "";\n\n`

  if (doc.head) {
    c += `${indent}HTMLText = HTMLText + "<html>";\n`
    c += `${indent}// <head>\n`
    c += `${indent}HTMLText = HTMLText + ${toExpr(esc(doc.head.outerHTML))};\n\n`
  }

  const bodyAttrs = doc.body
    ? Array.from(doc.body.attributes).map(a => ` ${a.name}=""${a.value}""`).join('')
    : ''
  c += `${indent}HTMLText = HTMLText + "<body${bodyAttrs}>";\n\n`

  if (doc.body) {
    c += generateElementByElement(doc.body, indent)
  }

  c += `${indent}HTMLText = HTMLText + "</body></html>";\n\n`
  c += `${indent}Return HTMLText;\n`

  if (createFunction) {
    c += `\nEndFunction\n\n`
    c += `#EndRegion\n`
  }

  return c
}
