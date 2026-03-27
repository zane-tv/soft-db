import { useState, useMemo } from 'react'

interface ExplainNode {
  'Node Type': string
  'Startup Cost'?: number
  'Total Cost'?: number
  'Plan Rows'?: number
  'Actual Rows'?: number
  'Actual Startup Time'?: number
  'Actual Total Time'?: number
  'Relation Name'?: string
  'Alias'?: string
  'Join Type'?: string
  'Index Name'?: string
  'Filter'?: string
  'Index Cond'?: string
  'Hash Cond'?: string
  'Sort Key'?: string[]
  'Strategy'?: string
  Plans?: ExplainNode[]
  [key: string]: unknown
}

interface ExplainPlan {
  Plan: ExplainNode
  'Planning Time'?: number
  'Execution Time'?: number
  'Triggers'?: unknown[]
}

interface ExplainViewProps {
  jsonData: string
  onClose: () => void
}

interface FlatNode {
  node: ExplainNode
  depth: number
  totalCost: number
}

function flattenPlan(node: ExplainNode, depth: number, result: FlatNode[]): void {
  result.push({ node, depth, totalCost: node['Total Cost'] ?? 0 })
  if (node.Plans) {
    for (const child of node.Plans) {
      flattenPlan(child, depth + 1, result)
    }
  }
}

function parseExplainJSON(jsonData: string): ExplainPlan | null {
  try {
    const parsed = JSON.parse(jsonData)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed[0] as ExplainPlan
    }
    if (parsed?.Plan) {
      return parsed as ExplainPlan
    }
    return null
  } catch {
    return null
  }
}

function formatTime(ms: number | undefined): string {
  if (ms === undefined || ms === null) return '-'
  if (ms < 1) return `${(ms * 1000).toFixed(0)} \u00b5s`
  if (ms < 1000) return `${ms.toFixed(2)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function formatNumber(n: number | undefined): string {
  if (n === undefined || n === null) return '-'
  return n.toLocaleString()
}

export function ExplainView({ jsonData, onClose }: ExplainViewProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set())

  const plan = useMemo(() => parseExplainJSON(jsonData), [jsonData])

  const flatNodes = useMemo(() => {
    if (!plan?.Plan) return []
    const result: FlatNode[] = []
    flattenPlan(plan.Plan, 0, result)
    return result
  }, [plan])

  const costThresholds = useMemo(() => {
    if (flatNodes.length === 0) return new Set<number>()
    const sorted = [...flatNodes].sort((a, b) => b.totalCost - a.totalCost)
    const topN = Math.min(3, sorted.length)
    const indices = new Set<number>()
    for (let i = 0; i < topN; i++) {
      if (sorted[i].totalCost > 0) {
        indices.add(flatNodes.indexOf(sorted[i]))
      }
    }
    return indices
  }, [flatNodes])

  const maxCost = useMemo(() => {
    return Math.max(...flatNodes.map(n => n.totalCost), 1)
  }, [flatNodes])

  const toggleExpand = (idx: number) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  if (!plan) {
    return (
      <div className="flex flex-col h-full bg-bg-card border border-border-subtle rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-bg-card/50">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-primary">search_insights</span>
            <span className="text-sm font-semibold text-text-main">Query Plan</span>
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-main transition-colors">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-8 text-text-muted text-sm">
          Failed to parse EXPLAIN output.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-bg-card border border-border-subtle rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-bg-card/50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-primary">search_insights</span>
            <span className="text-sm font-semibold text-text-main">Query Plan</span>
          </div>
          {plan['Planning Time'] !== undefined && (
            <span className="text-xs text-text-muted">
              Planning: {formatTime(plan['Planning Time'])}
            </span>
          )}
          {plan['Execution Time'] !== undefined && (
            <span className="text-xs text-text-muted">
              Execution: {formatTime(plan['Execution Time'])}
            </span>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-text-muted hover:text-text-main transition-colors p-1 rounded hover:bg-white/5">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Plan Tree Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-bg-card/80 backdrop-blur-sm border-b border-border-subtle">
            <tr>
              <th className="text-left px-3 py-2 text-text-muted font-medium">Node</th>
              <th className="text-right px-3 py-2 text-text-muted font-medium w-24">Startup Cost</th>
              <th className="text-right px-3 py-2 text-text-muted font-medium w-24">Total Cost</th>
              <th className="text-right px-3 py-2 text-text-muted font-medium w-20">Plan Rows</th>
              <th className="text-right px-3 py-2 text-text-muted font-medium w-20">Actual Rows</th>
              <th className="text-right px-3 py-2 text-text-muted font-medium w-24">Actual Time</th>
              <th className="text-left px-3 py-2 text-text-muted font-medium w-16">Cost %</th>
            </tr>
          </thead>
          <tbody>
            {flatNodes.map((item, idx) => {
              const isExpensive = costThresholds.has(idx)
              const costPercent = maxCost > 0 ? (item.totalCost / maxCost) * 100 : 0
              const hasDetails = !!(item.node['Filter'] || item.node['Index Cond'] || item.node['Hash Cond'] || item.node['Sort Key'] || item.node['Index Name'])
              const isExpanded = expandedNodes.has(idx)
              const nodeKey = `${item.node['Node Type']}-${item.depth}-${idx}`

              return (
                <tr
                  key={nodeKey}
                  className={`border-b border-border-subtle/40 transition-colors ${
                    isExpensive
                      ? 'bg-red-500/10 hover:bg-red-500/15'
                      : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-start gap-1" style={{ paddingLeft: `${item.depth * 20}px` }}>
                      {hasDetails ? (
                        <button
                          type="button"
                          onClick={() => toggleExpand(idx)}
                          className="text-text-muted hover:text-text-main mt-0.5 shrink-0"
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {isExpanded ? 'expand_more' : 'chevron_right'}
                          </span>
                        </button>
                      ) : (
                        <span className="w-[14px] shrink-0" />
                      )}
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          {isExpensive && (
                            <span className="material-symbols-outlined text-[12px] text-red-400">local_fire_department</span>
                          )}
                          <span className={`font-medium ${isExpensive ? 'text-red-300' : 'text-text-main'}`}>
                            {item.node['Node Type']}
                          </span>
                          {item.node['Relation Name'] && (
                            <span className="text-text-muted">
                              on <span className="text-blue-400">{item.node['Relation Name']}</span>
                              {item.node['Alias'] && item.node['Alias'] !== item.node['Relation Name'] && (
                                <> as {item.node['Alias']}</>
                              )}
                            </span>
                          )}
                          {item.node['Join Type'] && (
                            <span className="text-amber-400">({item.node['Join Type']})</span>
                          )}
                          {item.node['Strategy'] && (
                            <span className="text-purple-400">[{item.node['Strategy']}]</span>
                          )}
                        </div>
                        {isExpanded && (
                          <div className="mt-1 text-[10px] text-text-muted space-y-0.5 pl-1">
                            {item.node['Index Name'] && <div>Index: <span className="text-green-400">{item.node['Index Name']}</span></div>}
                            {item.node['Filter'] && <div>Filter: <span className="text-amber-300">{item.node['Filter']}</span></div>}
                            {item.node['Index Cond'] && <div>Index Cond: <span className="text-amber-300">{item.node['Index Cond']}</span></div>}
                            {item.node['Hash Cond'] && <div>Hash Cond: <span className="text-amber-300">{item.node['Hash Cond']}</span></div>}
                            {item.node['Sort Key'] && <div>Sort Key: <span className="text-amber-300">{(item.node['Sort Key'] as string[]).join(', ')}</span></div>}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="text-right px-3 py-2 text-text-muted tabular-nums">
                    {formatNumber(item.node['Startup Cost'])}
                  </td>
                  <td className={`text-right px-3 py-2 tabular-nums font-medium ${isExpensive ? 'text-red-300' : 'text-text-main'}`}>
                    {formatNumber(item.node['Total Cost'])}
                  </td>
                  <td className="text-right px-3 py-2 text-text-muted tabular-nums">
                    {formatNumber(item.node['Plan Rows'])}
                  </td>
                  <td className="text-right px-3 py-2 text-text-main tabular-nums">
                    {formatNumber(item.node['Actual Rows'])}
                  </td>
                  <td className={`text-right px-3 py-2 tabular-nums ${isExpensive ? 'text-red-300 font-medium' : 'text-text-main'}`}>
                    {formatTime(item.node['Actual Total Time'])}
                  </td>
                  <td className="px-3 py-2">
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isExpensive ? 'bg-red-500' : costPercent > 50 ? 'bg-amber-500' : 'bg-primary/60'
                        }`}
                        style={{ width: `${Math.max(costPercent, 2)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
