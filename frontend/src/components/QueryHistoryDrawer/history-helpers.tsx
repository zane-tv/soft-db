import type { HistoryEntry } from '../../../bindings/soft-db/internal/store/models'

const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|AND|OR|INSERT|UPDATE|DELETE|SET|INTO|VALUES|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|WITH|RETURNING|NOT|NULL|IN|EXISTS|LIKE|BETWEEN|CASE|WHEN|THEN|ELSE|END|UNION|ALL|DISTINCT|CREATE|ALTER|DROP|TABLE|INDEX|VIEW|FUNCTION|IF|BEGIN|COMMIT|ROLLBACK|DESC|ASC|COUNT|SUM|AVG|MIN|MAX|NOW)\b/gi
const SQL_STRINGS = /('[^']*')/g

export function highlightSQL(sql: string): JSX.Element[] {
  const parts: JSX.Element[] = []
  let key = 0
  const segments = sql.split(SQL_STRINGS)

  for (const seg of segments) {
    if (seg.startsWith("'") && seg.endsWith("'")) {
      parts.push(<span key={key++} className="text-emerald-400">{seg}</span>)
    } else {
      const inner = seg.split(SQL_KEYWORDS)
      for (const word of inner) {
        if (SQL_KEYWORDS.test(word)) {
          SQL_KEYWORDS.lastIndex = 0
          parts.push(<span key={key++} className="text-primary-muted">{word}</span>)
        } else {
          parts.push(<span key={key++}>{word}</span>)
        }
      }
    }
  }
  return parts
}

export function groupByDate(items: HistoryEntry[]): { label: string; entries: HistoryEntry[] }[] {
  const groups = new Map<string, HistoryEntry[]>()
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()

  for (const item of items) {
    const d = new Date(item.createdAt).toDateString()
    const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : d
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(item)
  }
  return Array.from(groups.entries()).map(([label, entries]) => ({ label, entries }))
}

export function inferSnippetTitle(query: string): string {
  const cleaned = query.replace(/\s+/g, ' ').trim().replace(/;$/, '')
  if (!cleaned) return 'Untitled snippet'
  return cleaned.slice(0, 56)
}

export function parseTags(input: string): string[] {
  if (!input.trim()) return []
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag, idx, list) => tag.length > 0 && list.indexOf(tag) === idx)
}

export function formatScope(scope: string): string {
  return scope === 'global' ? 'Global' : 'Connection'
}
