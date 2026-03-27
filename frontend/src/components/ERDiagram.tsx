import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  MarkerType,
  BackgroundVariant,
  Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useQueries } from '@tanstack/react-query'
import * as SchemaService from '../../bindings/soft-db/services/schemaservice'
import type { TableInfo, ColumnInfo, ForeignKeyInfo } from '../../bindings/soft-db/internal/driver/models'
import { useTheme } from '../hooks/useTheme'

interface ERDiagramProps {
  connectionId: string
  tables: TableInfo[]
  database?: string
}

interface TableNodeData extends Record<string, unknown> {
  tableName: string
  columns: ColumnInfo[]
  isSelected: boolean
  highlightedColumns: Set<string>
}

const TABLE_NODE_WIDTH = 220
const TABLE_HEADER_HEIGHT = 36
const TABLE_ROW_HEIGHT = 26

async function computeElkLayout(
  tables: string[],
  edges: Array<{ source: string; target: string }>,
  nodeWidth: number,
  columnCounts: Map<string, number>,
): Promise<Map<string, { x: number; y: number }>> {
  const ELK = (await import('elkjs/lib/elk.bundled.js')).default
  const elk = new ELK()

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
    },
    children: tables.map((t) => ({
      id: t,
      width: nodeWidth,
      height: TABLE_HEADER_HEIGHT + (columnCounts.get(t) ?? 0) * TABLE_ROW_HEIGHT + 8,
    })),
    edges: edges.map((e, i) => ({
      id: `e-${i}-${e.source}-${e.target}`,
      sources: [e.source],
      targets: [e.target],
    })),
  }

  const result = await elk.layout(graph)
  const positions = new Map<string, { x: number; y: number }>()
  for (const child of result.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
  }
  return positions
}

function TableNode({ data }: NodeProps) {
  const d = data as TableNodeData
  const { tableName, columns, isSelected, highlightedColumns } = d

  return (
    <div
      className={[
        'rounded-lg border text-xs font-mono select-none overflow-hidden',
        'shadow-lg transition-all duration-150',
        isSelected
          ? 'border-primary shadow-primary/30 ring-1 ring-primary/40'
          : 'border-border-subtle bg-bg-card',
      ].join(' ')}
      style={{ width: TABLE_NODE_WIDTH }}
    >
      <Handle type="source" position={Position.Right} style={{ background: 'transparent', border: 'none' }} />
      <Handle type="target" position={Position.Left} style={{ background: 'transparent', border: 'none' }} />
      <div
        className={[
          'flex items-center gap-2 px-3 py-2 font-semibold text-[11px] uppercase tracking-wide',
          isSelected ? 'bg-primary/20 text-primary' : 'bg-bg-card text-text-muted',
        ].join(' ')}
        style={{ height: TABLE_HEADER_HEIGHT }}
      >
        <span className="material-symbols-outlined text-[14px]">table</span>
        <span className="truncate">{tableName}</span>
      </div>
      <div className="divide-y divide-border-subtle/40">
        {columns.map((col) => {
          const isHighlighted = highlightedColumns.has(col.name)
          return (
            <div
              key={col.name}
              className={[
                'flex items-center justify-between px-3 gap-2',
                isHighlighted ? 'bg-primary/10 text-text-main' : 'text-text-muted',
              ].join(' ')}
              style={{ height: TABLE_ROW_HEIGHT }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {col.primaryKey ? (
                  <span className="material-symbols-outlined text-[11px] text-amber-400 shrink-0">key</span>
                ) : isHighlighted ? (
                  <span className="material-symbols-outlined text-[11px] text-primary shrink-0">link</span>
                ) : (
                  <span className="w-[11px] shrink-0" />
                )}
                <span className={['truncate text-[11px]', col.primaryKey ? 'text-amber-300 font-medium' : ''].join(' ')}>
                  {col.name}
                </span>
              </div>
              <span className="text-[10px] text-text-muted/60 truncate shrink-0 max-w-[70px]">{col.type}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const nodeTypes = { tableNode: TableNode }

export function ERDiagram({ connectionId, tables, database }: ERDiagramProps) {
  const { theme } = useTheme()
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [layoutReady, setLayoutReady] = useState(false)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const colorMode = theme === 'light' ? 'light' : 'dark'

  const tableNames = useMemo(
    () => tables.filter((t) => t.type === 'table' || t.type === '').map((t) => t.name),
    [tables],
  )

  const columnsResults = useQueries({
    queries: tableNames.map((name) => ({
      queryKey: ['er-columns', connectionId, database ?? '', name],
      queryFn: () => SchemaService.GetColumns(connectionId, name),
      enabled: !!connectionId && tableNames.length > 0,
      staleTime: 60_000,
    })),
  })

  const fkResults = useQueries({
    queries: tableNames.map((name) => ({
      queryKey: ['er-fks', connectionId, database ?? '', name],
      queryFn: () => SchemaService.GetTableForeignKeys(connectionId, database ?? '', name),
      enabled: !!connectionId && tableNames.length > 0,
      staleTime: 60_000,
    })),
  })

  // biome-ignore lint: stable fingerprints to avoid useQueries new-array-ref causing infinite re-renders
  const columnsDataFingerprint = columnsResults.map((q) => q.dataUpdatedAt).join(',')
  // biome-ignore lint: stable fingerprints to avoid useQueries new-array-ref causing infinite re-renders
  const fkDataFingerprint = fkResults.map((q) => q.dataUpdatedAt).join(',')

  // biome-ignore lint/correctness/useExhaustiveDependencies: fingerprint replaces columnsResults for render stability
  const columnsMap = useMemo(() => {
    const m = new Map<string, ColumnInfo[]>()
    tableNames.forEach((name, i) => {
      const data = columnsResults[i]?.data
      if (data) m.set(name, data as ColumnInfo[])
    })
    return m
  }, [tableNames, columnsDataFingerprint])

  // biome-ignore lint/correctness/useExhaustiveDependencies: fingerprint replaces fkResults for render stability
  const fkMap = useMemo(() => {
    const m = new Map<string, ForeignKeyInfo[]>()
    tableNames.forEach((name, i) => {
      const data = fkResults[i]?.data
      if (data) m.set(name, data as ForeignKeyInfo[])
    })
    return m
  }, [tableNames, fkDataFingerprint])

  const allLoaded = useMemo(
    () =>
      tableNames.length === 0 ||
      (columnsResults.every((q) => !q.isLoading) && fkResults.every((q) => !q.isLoading)),
    [tableNames.length, columnsResults, fkResults],
  )

  const { highlightedByTable, relatedTables } = useMemo(() => {
    if (!selectedTable) {
      return { highlightedByTable: new Map<string, Set<string>>(), relatedTables: new Set<string>() }
    }

    const colsHighlighted = new Map<string, Set<string>>()
    const related = new Set<string>()

    for (const fk of fkMap.get(selectedTable) ?? []) {
      if (!colsHighlighted.has(selectedTable)) colsHighlighted.set(selectedTable, new Set())
      colsHighlighted.get(selectedTable)!.add(fk.columnName)
      if (!colsHighlighted.has(fk.referencedTable)) colsHighlighted.set(fk.referencedTable, new Set())
      colsHighlighted.get(fk.referencedTable)!.add(fk.referencedColumn)
      related.add(fk.referencedTable)
    }

    for (const [srcTable, fks] of fkMap.entries()) {
      for (const fk of fks) {
        if (fk.referencedTable === selectedTable) {
          if (!colsHighlighted.has(srcTable)) colsHighlighted.set(srcTable, new Set())
          colsHighlighted.get(srcTable)!.add(fk.columnName)
          if (!colsHighlighted.has(selectedTable)) colsHighlighted.set(selectedTable, new Set())
          colsHighlighted.get(selectedTable)!.add(fk.referencedColumn)
          related.add(srcTable)
        }
      }
    }

    return { highlightedByTable: colsHighlighted, relatedTables: related }
  }, [selectedTable, fkMap])

  const buildingRef = useRef(false)

  useEffect(() => {
    if (!allLoaded || tableNames.length === 0) return
    if (buildingRef.current) return

    const buildGraph = async () => {
      buildingRef.current = true
      setLayoutReady(false)

      const rawEdges: Array<{ source: string; target: string; fkName: string }> = []
      for (const [srcTable, fks] of fkMap.entries()) {
        for (const fk of fks) {
          if (tableNames.includes(fk.referencedTable)) {
            rawEdges.push({ source: srcTable, target: fk.referencedTable, fkName: fk.name })
          }
        }
      }

      const columnCounts = new Map<string, number>()
      for (const name of tableNames) {
        columnCounts.set(name, (columnsMap.get(name) ?? []).length)
      }

      let positions: Map<string, { x: number; y: number }>
      try {
        positions = await computeElkLayout(
          tableNames,
          rawEdges.map((e) => ({ source: e.source, target: e.target })),
          TABLE_NODE_WIDTH,
          columnCounts,
        )
      } catch {
        positions = new Map()
        const cols = Math.ceil(Math.sqrt(tableNames.length))
        tableNames.forEach((name, i) => {
          positions.set(name, { x: (i % cols) * (TABLE_NODE_WIDTH + 60), y: Math.floor(i / cols) * 280 })
        })
      }

      const newNodes: Node[] = tableNames.map((name) => ({
        id: name,
        type: 'tableNode',
        position: positions.get(name) ?? { x: 0, y: 0 },
        data: {
          tableName: name,
          columns: columnsMap.get(name) ?? [],
          isSelected: false,
          highlightedColumns: new Set<string>(),
        } satisfies TableNodeData,
        style: { width: TABLE_NODE_WIDTH },
      }))

      const seenEdgeKeys = new Set<string>()
      const newEdges: Edge[] = []
      for (const e of rawEdges) {
        const key = `${e.source}→${e.target}→${e.fkName}`
        if (seenEdgeKeys.has(key)) continue
        seenEdgeKeys.add(key)
        newEdges.push({
          id: `${e.source}-${e.target}-${e.fkName}`,
          source: e.source,
          target: e.target,
          type: 'smoothstep',
          animated: false,
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: 'var(--color-primary)' },
          style: { stroke: 'var(--color-primary)', strokeWidth: 1.5, opacity: 0.7 },
        })
      }

      setNodes(newNodes)
      setEdges(newEdges)
      setLayoutReady(true)
      buildingRef.current = false
    }

    buildGraph()
  }, [allLoaded, tableNames, columnsMap, fkMap, setNodes, setEdges])

  useEffect(() => {
    if (!layoutReady) return

    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...(n.data as TableNodeData),
          isSelected: n.id === selectedTable,
          highlightedColumns: highlightedByTable.get(n.id) ?? new Set<string>(),
        } satisfies TableNodeData,
      })),
    )

    setEdges((eds) =>
      eds.map((e) => {
        if (!selectedTable) return { ...e, style: { ...e.style, opacity: 0.7 } }
        const isRelated = e.source === selectedTable || e.target === selectedTable
        return {
          ...e,
          style: { ...e.style, opacity: isRelated ? 1 : 0.15, strokeWidth: isRelated ? 2.5 : 1 },
          animated: isRelated,
        }
      }),
    )
  }, [selectedTable, highlightedByTable, layoutReady, setNodes, setEdges])

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedTable((prev) => (prev === node.id ? null : node.id))
  }, [])

  const handlePaneClick = useCallback(() => setSelectedTable(null), [])

  const isLoading = !allLoaded || (tableNames.length > 0 && !layoutReady)

  return (
    <div className="relative w-full h-full bg-bg-app">
      {isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-bg-app">
          <span className="material-symbols-outlined text-[32px] text-text-muted animate-spin">sync</span>
          <span className="text-sm text-text-muted">Building ER diagram…</span>
        </div>
      )}
      {!isLoading && tableNames.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-muted">
          <span className="material-symbols-outlined text-[40px]">schema</span>
          <span className="text-sm">No tables found for this connection.</span>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
        colorMode={colorMode}
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border-subtle)" />
        <Controls showInteractive={false} className="!bg-bg-card !border-border-subtle !rounded-lg !shadow-lg" />
        {selectedTable && (
          <Panel position="top-right">
            <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-bg-card px-3 py-2 text-xs text-text-muted shadow">
              <span className="material-symbols-outlined text-[14px] text-primary">info</span>
              <span>
                <span className="text-primary font-medium">{selectedTable}</span>
                {' — click another table or canvas to deselect'}
              </span>
              {relatedTables.size > 0 && (
                <span className="text-text-muted/70">
                  ({relatedTables.size} relation{relatedTables.size !== 1 ? 's' : ''})
                </span>
              )}
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  )
}
