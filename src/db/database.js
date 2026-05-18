import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbPath = join(__dirname, '..', 'db', 'database.sqlite')

const db = new Database(dbPath)

const schemas = [
  `CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    template TEXT NOT NULL,
    template_result TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS selectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL DEFAULT '',
    selector TEXT NOT NULL,
    parent_id INTEGER,
    template_id INTEGER,
    FOREIGN KEY (parent_id) REFERENCES selectors(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS parameters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT '',
    value TEXT NOT NULL DEFAULT '',
    selector_id INTEGER NOT NULL,
    FOREIGN KEY (selector_id) REFERENCES selectors(id) ON DELETE CASCADE
  )`
]

for (const schema of schemas) {
  db.exec(schema)
}

export default db