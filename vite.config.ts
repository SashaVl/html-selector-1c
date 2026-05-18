import { defineConfig } from 'vite'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbPath = join(__dirname, 'src', 'db', 'database.sqlite')
const db = new Database(dbPath)

db.exec(`CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  template_result TEXT NOT NULL DEFAULT '',
  function_name TEXT NOT NULL DEFAULT 'GetHTMLTemplate',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`)
try {
  db.exec(`ALTER TABLE templates ADD COLUMN function_name TEXT NOT NULL DEFAULT 'GetHTMLTemplate'`)
} catch {}
db.exec(`CREATE TABLE IF NOT EXISTS selectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL DEFAULT '',
  selector TEXT NOT NULL,
  parent_id INTEGER,
  template_id INTEGER,
  FOREIGN KEY (parent_id) REFERENCES selectors(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
)`)
db.exec(`CREATE TABLE IF NOT EXISTS parameters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL DEFAULT '',
  selector_id INTEGER NOT NULL,
  FOREIGN KEY (selector_id) REFERENCES selectors(id) ON DELETE CASCADE
)`)

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => resolve(body))
  })
}

export default defineConfig({
  plugins: [
    {
      name: 'sqlite-api',
      configureServer(server) {
        server.middlewares.use('/api/templates', async (req: IncomingMessage, res: ServerResponse, next) => {
          if (req.method === 'GET') {
            const url = req.url || '/'
            const idMatch = url.match(/^\/(\d+)(?:\?.*)?$/)
            if (idMatch) {
              try {
                const id = parseInt(idMatch[1])
                const template = db.prepare('SELECT id, name, template, function_name FROM templates WHERE id = ?').get(id)
                if (template) {
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify(template))
                } else {
                  res.writeHead(404, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ error: 'Not found' }))
                }
              } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: String(e) }))
              }
            } else {
              try {
                const templates = db.prepare('SELECT id, name, created_at FROM templates ORDER BY created_at DESC').all()
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(templates))
              } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: String(e) }))
              }
            }
          } else if (req.method === 'POST') {
            try {
              const body = await readBody(req)
              const { name, template } = JSON.parse(body)
              const stmt = db.prepare('INSERT INTO templates (name, template, template_result) VALUES (?, ?, ?)')
              const result = stmt.run(name, template, '')
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ id: result.lastInsertRowid }))
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e) }))
            }
          } else if (req.method === 'PUT') {
            const idMatch2 = (req.url || '/').match(/^\/(\d+)(?:\?.*)?$/)
            if (idMatch2) {
              try {
                const id = parseInt(idMatch2[1])
                const body = await readBody(req)
                const data = JSON.parse(body)
                if (data.name !== undefined) db.prepare('UPDATE templates SET name = ? WHERE id = ?').run(data.name, id)
                if (data.function_name !== undefined) db.prepare('UPDATE templates SET function_name = ? WHERE id = ?').run(data.function_name, id)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true }))
              } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: String(e) }))
              }
            } else {
              next()
            }
          } else if (req.method === 'DELETE') {
            const idMatch3 = (req.url || '/').match(/^\/(\d+)(?:\?.*)?$/)
            if (idMatch3) {
              try {
                const id = parseInt(idMatch3[1])
                db.prepare('DELETE FROM templates WHERE id = ?').run(id)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true }))
              } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: String(e) }))
              }
            } else {
              next()
            }
          } else {
            next()
          }
        })

        server.middlewares.use('/api/selectors', async (req: IncomingMessage, res: ServerResponse, next) => {
          const url = req.url || '/'
          const idMatch = url.match(/^\/(\d+)(?:\?.*)?$/)

          if (req.method === 'GET') {
            try {
              const qs = new URLSearchParams(url.split('?')[1] ?? '')
              const templateId = qs.get('template_id')
              if (!templateId) { next(); return }
              const selectors = db.prepare(
                'SELECT * FROM selectors WHERE template_id = ? ORDER BY id'
              ).all(parseInt(templateId)) as any[]
              const parameters = selectors.length > 0
                ? db.prepare(
                    `SELECT * FROM parameters WHERE selector_id IN (${selectors.map(() => '?').join(',')})`
                  ).all(...selectors.map((s: any) => s.id)) as any[]
                : []
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ selectors, parameters }))
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e) }))
            }
          } else if (req.method === 'POST' && !idMatch) {
            try {
              const body = await readBody(req)
              const { type, key, selector, parent_id, template_id } = JSON.parse(body)
              const result = db.prepare(
                'INSERT INTO selectors (type, key, selector, parent_id, template_id) VALUES (?, ?, ?, ?, ?)'
              ).run(type ?? '', key ?? '', selector, parent_id ?? null, template_id ?? null)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ id: result.lastInsertRowid }))
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e) }))
            }
          } else if (req.method === 'PUT' && idMatch) {
            try {
              const id = parseInt(idMatch[1])
              const body = await readBody(req)
              const { type, key, selector } = JSON.parse(body)
              db.prepare('UPDATE selectors SET type = ?, key = ?, selector = ? WHERE id = ?')
                .run(type ?? '', key ?? '', selector, id)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true }))
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e) }))
            }
          } else if (req.method === 'DELETE' && idMatch) {
            try {
              const id = parseInt(idMatch[1])
              db.prepare('DELETE FROM selectors WHERE id = ?').run(id)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true }))
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e) }))
            }
          } else {
            next()
          }
        })

        server.middlewares.use('/api/parameters', async (req: IncomingMessage, res: ServerResponse, next) => {
          const url = req.url || '/'
          const idMatch = url.match(/^\/(\d+)(?:\?.*)?$/)

          if (req.method === 'POST' && !idMatch) {
            try {
              const body = await readBody(req)
              const { key, type, value, selector_id } = JSON.parse(body)
              const result = db.prepare(
                'INSERT INTO parameters (key, type, value, selector_id) VALUES (?, ?, ?, ?)'
              ).run(key ?? '', type ?? '', value ?? '', selector_id)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ id: result.lastInsertRowid }))
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e) }))
            }
          } else if (req.method === 'PUT' && idMatch) {
            try {
              const id = parseInt(idMatch[1])
              const body = await readBody(req)
              const { key, type, value } = JSON.parse(body)
              db.prepare('UPDATE parameters SET key = ?, type = ?, value = ? WHERE id = ?')
                .run(key ?? '', type ?? '', value ?? '', id)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true }))
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e) }))
            }
          } else if (req.method === 'DELETE' && idMatch) {
            try {
              const id = parseInt(idMatch[1])
              db.prepare('DELETE FROM parameters WHERE id = ?').run(id)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true }))
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e) }))
            }
          } else {
            next()
          }
        })
      }
    }
  ]
})
