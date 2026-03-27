import { useRef, useEffect, useCallback } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { useSettingsContext } from '@/hooks/useSettings'
import * as SchemaService from '../../bindings/soft-db/services/schemaservice'
import type { ColumnInfo } from '../../bindings/soft-db/internal/driver/models'

// ─── Types ───
interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  onExecute?: () => void
  onExplain?: () => void
  onOptimize?: () => void
  explainDisabled?: boolean
  explainDisabledReason?: string
  tables?: { name: string }[]
  views?: string[]
  functions?: { name: string }[]
  connectionId?: string
  connType?: string
}

// ─── Theme Definitions ───
const MONACO_THEMES: Record<string, Monaco.editor.IStandaloneThemeData> = {
  dark: {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'A78BFA', fontStyle: 'bold' },
      { token: 'string', foreground: '34D399' },
      { token: 'string.sql', foreground: '34D399' },
      { token: 'number', foreground: 'F472B6' },
      { token: 'comment', foreground: '71717A', fontStyle: 'italic' },
      { token: 'operator', foreground: 'A1A1AA' },
      { token: 'predefined', foreground: '60A5FA' },
      { token: 'type', foreground: 'FBBF24' },
    ],
    colors: {
      'editor.background': '#121215',
      'editor.foreground': '#F4F4F5',
      'editorCursor.foreground': '#3c83f6',
      'editor.lineHighlightBackground': '#27272A',
      'editor.selectionBackground': '#3c83f633',
      'editorLineNumber.foreground': '#52525B',
      'editorLineNumber.activeForeground': '#A1A1AA',
      'editorWidget.background': '#27272A',
      'editorWidget.border': '#3F3F46',
      'editorSuggestWidget.background': '#27272A',
      'editorSuggestWidget.border': '#3F3F46',
      'editorSuggestWidget.selectedBackground': '#3F3F46',
      'editorSuggestWidget.highlightForeground': '#3c83f6',
    },
  },
  light: {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '7C3AED', fontStyle: 'bold' },
      { token: 'string', foreground: '059669' },
      { token: 'string.sql', foreground: '059669' },
      { token: 'number', foreground: 'DB2777' },
      { token: 'comment', foreground: '94A3B8', fontStyle: 'italic' },
      { token: 'operator', foreground: '64748B' },
      { token: 'predefined', foreground: '2563EB' },
      { token: 'type', foreground: 'D97706' },
    ],
    colors: {
      'editor.background': '#F8FAFC',
      'editor.foreground': '#1E293B',
      'editorCursor.foreground': '#3c83f6',
      'editor.lineHighlightBackground': '#F1F5F9',
      'editor.selectionBackground': '#3c83f633',
      'editorLineNumber.foreground': '#94A3B8',
      'editorLineNumber.activeForeground': '#64748B',
      'editorWidget.background': '#FFFFFF',
      'editorWidget.border': '#E2E8F0',
      'editorSuggestWidget.background': '#FFFFFF',
      'editorSuggestWidget.border': '#E2E8F0',
      'editorSuggestWidget.selectedBackground': '#F1F5F9',
      'editorSuggestWidget.highlightForeground': '#3c83f6',
    },
  },
  nord: {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'B48EAD', fontStyle: 'bold' },
      { token: 'string', foreground: 'A3BE8C' },
      { token: 'string.sql', foreground: 'A3BE8C' },
      { token: 'number', foreground: 'D08770' },
      { token: 'comment', foreground: '616E88', fontStyle: 'italic' },
      { token: 'operator', foreground: 'D8DEE9' },
      { token: 'predefined', foreground: '88C0D0' },
      { token: 'type', foreground: 'EBCB8B' },
    ],
    colors: {
      'editor.background': '#272C36',
      'editor.foreground': '#ECEFF4',
      'editorCursor.foreground': '#88C0D0',
      'editor.lineHighlightBackground': '#3B4252',
      'editor.selectionBackground': '#88C0D033',
      'editorLineNumber.foreground': '#4C566A',
      'editorLineNumber.activeForeground': '#D8DEE9',
      'editorWidget.background': '#3B4252',
      'editorWidget.border': '#4C566A',
      'editorSuggestWidget.background': '#3B4252',
      'editorSuggestWidget.border': '#4C566A',
      'editorSuggestWidget.selectedBackground': '#434C5E',
      'editorSuggestWidget.highlightForeground': '#88C0D0',
    },
  },
  dracula: {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'FF79C6', fontStyle: 'bold' },
      { token: 'string', foreground: '50FA7B' },
      { token: 'string.sql', foreground: '50FA7B' },
      { token: 'number', foreground: 'BD93F9' },
      { token: 'comment', foreground: '6272A4', fontStyle: 'italic' },
      { token: 'operator', foreground: 'F8F8F2' },
      { token: 'predefined', foreground: '8BE9FD' },
      { token: 'type', foreground: 'F1FA8C' },
    ],
    colors: {
      'editor.background': '#21222C',
      'editor.foreground': '#F8F8F2',
      'editorCursor.foreground': '#BD93F9',
      'editor.lineHighlightBackground': '#44475A',
      'editor.selectionBackground': '#BD93F933',
      'editorLineNumber.foreground': '#6272A4',
      'editorLineNumber.activeForeground': '#F8F8F2',
      'editorWidget.background': '#44475A',
      'editorWidget.border': '#6272A4',
      'editorSuggestWidget.background': '#44475A',
      'editorSuggestWidget.border': '#6272A4',
      'editorSuggestWidget.selectedBackground': '#6272A4',
      'editorSuggestWidget.highlightForeground': '#BD93F9',
    },
  },
}

export function SqlEditor({
  value,
  onChange,
  onExecute,
  onExplain,
  onOptimize,
  explainDisabled = false,
  explainDisabledReason,
  tables = [],
  views = [],
  functions = [],
  connectionId,
  connType,
}: SqlEditorProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const disposablesRef = useRef<Monaco.IDisposable[]>([])
  // Cache: tableName → fetched columns (lazy, on-demand)
  const columnCacheRef = useRef<Map<string, ColumnInfo[]>>(new Map())
  // Track in-flight fetches to avoid duplicate requests
  const pendingFetchRef = useRef<Set<string>>(new Set())
  // ── Ref-based schema data ──
  // Provider is registered ONCE at mount; refs ensure it always reads the latest data
  const tablesRef = useRef(tables)
  const viewsRef = useRef(views)
  const functionsRef = useRef(functions)
  const connectionIdRef = useRef(connectionId)
  const connTypeRef = useRef(connType)
  const onExplainRef = useRef(onExplain)
  const onOptimizeRef = useRef(onOptimize)
  const explainDisabledRef = useRef(explainDisabled)
  const explainDisabledReasonRef = useRef(explainDisabledReason)
  const { settings } = useSettingsContext()
  const settingsRef = useRef(settings)
  const isMongo = connType === 'mongodb'
  const isRedis = connType === 'redis'

  const editorLanguage = isMongo ? 'json' : isRedis ? 'plaintext' : 'sql'

  // Keep refs in sync with latest props (no re-registration needed)
  useEffect(() => { tablesRef.current = tables }, [tables])
  useEffect(() => { viewsRef.current = views }, [views])
  useEffect(() => { functionsRef.current = functions }, [functions])
  useEffect(() => { connectionIdRef.current = connectionId; connTypeRef.current = connType; columnCacheRef.current.clear(); pendingFetchRef.current.clear() }, [connectionId, connType])
  useEffect(() => { onExplainRef.current = onExplain }, [onExplain])
  useEffect(() => { onOptimizeRef.current = onOptimize }, [onOptimize])
  useEffect(() => { explainDisabledRef.current = explainDisabled }, [explainDisabled])
  useEffect(() => { explainDisabledReasonRef.current = explainDisabledReason }, [explainDisabledReason])
  useEffect(() => { settingsRef.current = settings }, [settings])

  // Sync theme with app theme
  useEffect(() => {
    const syncTheme = () => {
      const theme = document.documentElement.getAttribute('data-theme') || 'dark'
      if (monacoRef.current) {
        monacoRef.current.editor.setTheme(`softdb-${theme}`)
      }
    }

    syncTheme()
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // Register completions — called ONCE at editor mount.
  // Reads data via refs so it always has the latest tables/views/functions.
  const registerCompletions = useCallback((monaco: typeof Monaco) => {
    disposablesRef.current.forEach((d) => {
      d.dispose()
    })
    disposablesRef.current = []

    const provider: Monaco.languages.CompletionItemProvider = {
      triggerCharacters: ['.'],
      provideCompletionItems: (model: Monaco.editor.ITextModel, position: Monaco.Position) => {
        // ── Read latest data from refs ──
        const currentTables = tablesRef.current
        const currentViews = viewsRef.current
        const currentFunctions = functionsRef.current
        const currentConnectionId = connectionIdRef.current
        const tableNames = new Set(currentTables.map((t) => t.name))

        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        // ── Detect `tableName.` context ──
        const charBeforeWord = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn - 1,
          endLineNumber: position.lineNumber,
          endColumn: word.startColumn,
        })

        if (charBeforeWord === '.') {
          const lineUpToDot = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: word.startColumn - 1,
          })
          const match = lineUpToDot.match(/([\w_]+)\s*$/)
          const tableName = match ? match[1] : null

          if (tableName && tableNames.has(tableName) && currentConnectionId) {
            const cached = columnCacheRef.current.get(tableName)

            if (cached) {
              return {
                suggestions: cached.map((col) => ({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  detail: `${col.type}${col.primaryKey ? ' 🔑 PK' : ''}${col.nullable ? '' : ' NOT NULL'}`,
                  insertText: col.name,
                  sortText: col.primaryKey ? '0' + col.name : '1' + col.name,
                  range,
                })),
              }
            }

            if (!pendingFetchRef.current.has(tableName)) {
              pendingFetchRef.current.add(tableName)
              SchemaService.GetColumns(currentConnectionId, tableName)
                .then((cols) => { columnCacheRef.current.set(tableName, cols) })
                .catch((err) => { console.warn('GetColumns failed', { connectionId: currentConnectionId, tableName, err }) })
                .finally(() => {
                  pendingFetchRef.current.delete(tableName)
                  editorRef.current?.trigger('keyboard', 'editor.action.triggerSuggest', {})
                })
            }

            // Return empty while fetching — widget stays silent, re-triggers when done
            return { suggestions: [] }
          }
        }

        // ── Normal suggestions: tables, views, functions, snippets ──
        const suggestions: Monaco.languages.CompletionItem[] = []

        currentTables.forEach((t) => {
          suggestions.push({
            label: t.name,
            kind: monaco.languages.CompletionItemKind.Struct,
            detail: 'Table',
            insertText: t.name,
            range,
          })
        })

        currentViews.forEach((v) => {
          suggestions.push({
            label: v,
            kind: monaco.languages.CompletionItemKind.Interface,
            detail: 'View',
            insertText: v,
            range,
          })
        })

        currentFunctions.forEach((f) => {
          suggestions.push({
            label: f.name,
            kind: monaco.languages.CompletionItemKind.Function,
            detail: 'Function',
            insertText: `${f.name}()`,
            range,
          })
        })

        const modelLang = model.getLanguageId()
        const isMongoConn = connTypeRef.current === 'mongodb' || modelLang === 'json'
        const isRedisConn = connTypeRef.current === 'redis' || modelLang === 'plaintext'
        const isSqlConn = !isMongoConn && !isRedisConn

        if (isRedisConn) return { suggestions: [] }
        if (isMongoConn && modelLang === 'sql') return { suggestions: [] }
        if (isSqlConn && modelLang === 'json') return { suggestions: [] }
        const snippets = isMongoConn ? [
          { label: 'find', insert: '{ "collection": "${1:name}", "action": "find", "filter": { $2 }, "limit": 100 }', detail: 'Find documents' },
          { label: 'find all', insert: '{ "collection": "${1:name}", "action": "find", "filter": {} }', detail: 'Find all documents' },
          { label: 'count', insert: '{ "collection": "${1:name}", "action": "count", "filter": { $2 } }', detail: 'Count documents' },
          { label: 'insert', insert: '{ "collection": "${1:name}", "action": "insert", "document": { $2 } }', detail: 'Insert document' },
          { label: 'delete', insert: '{ "collection": "${1:name}", "action": "delete", "filter": { $2 } }', detail: 'Delete documents' },
          { label: 'filter $gt', insert: '"${1:field}": { "$$gt": ${2:value} }', detail: 'Greater than' },
          { label: 'filter $lt', insert: '"${1:field}": { "$$lt": ${2:value} }', detail: 'Less than' },
          { label: 'filter $in', insert: '"${1:field}": { "$$in": [$2] }', detail: 'In array' },
          { label: 'filter $regex', insert: '"${1:field}": { "$$regex": "${2:pattern}" }', detail: 'Regex match' },
        ] : [
          { label: 'SELECT', insert: 'SELECT $1\nFROM $2\nWHERE $3;', detail: 'Select query' },
          { label: 'INSERT INTO', insert: 'INSERT INTO $1 ($2)\nVALUES ($3);', detail: 'Insert row' },
          { label: 'UPDATE', insert: 'UPDATE $1\nSET $2 = $3\nWHERE $4;', detail: 'Update rows' },
          { label: 'DELETE FROM', insert: 'DELETE FROM $1\nWHERE $2;', detail: 'Delete rows' },
          { label: 'CREATE TABLE', insert: 'CREATE TABLE $1 (\n  id SERIAL PRIMARY KEY,\n  $2\n);', detail: 'Create table' },
          { label: 'ALTER TABLE', insert: 'ALTER TABLE $1\nADD COLUMN $2;', detail: 'Alter table' },
          { label: 'JOIN', insert: 'JOIN $1 ON $2.$3 = $4.$5', detail: 'Inner join' },
          { label: 'LEFT JOIN', insert: 'LEFT JOIN $1 ON $2.$3 = $4.$5', detail: 'Left join' },
          { label: 'GROUP BY', insert: 'GROUP BY $1\nHAVING $2', detail: 'Group results' },
          { label: 'ORDER BY', insert: 'ORDER BY $1 DESC', detail: 'Order results' },
        ]

        snippets.forEach((s) => {
          suggestions.push({
            label: s.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: s.detail,
            insertText: s.insert,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })
        })

        return { suggestions }
      },
    }

    // Register on sql, javascript, and json so completions work in all language modes
    const d1 = monaco.languages.registerCompletionItemProvider('sql', provider)
    const d2 = monaco.languages.registerCompletionItemProvider('javascript', provider)
    const d3 = monaco.languages.registerCompletionItemProvider('json', provider)
    disposablesRef.current.push(d1, d2, d3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // ← empty deps: register ONCE, data comes from refs

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // Define all themes
    Object.entries(MONACO_THEMES).forEach(([name, themeData]) => {
      monaco.editor.defineTheme(`softdb-${name}`, themeData)
    })

    // Set initial theme
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark'
    monaco.editor.setTheme(`softdb-${currentTheme}`)

    // Register completions
    registerCompletions(monaco)

    // ── Manual suggest trigger ──
    // quickSuggestions may not fire reliably in some WebView environments (e.g., WebKit2GTK on Linux).
    // We manually trigger the suggest widget on every content change when the cursor is on a word.
    editor.onDidChangeModelContent((e) => {
      const model = editor.getModel()
      const pos = editor.getPosition()
      if (!model || !pos) return

      // ── Auto-uppercase SQL keywords ──
      if (settingsRef.current.autoUppercase && connTypeRef.current !== 'mongodb' && connTypeRef.current !== 'redis') {
        const SQL_KEYWORDS = /^(select|from|where|insert|into|update|set|delete|drop|alter|create|table|index|join|inner|outer|left|right|cross|on|and|or|not|in|is|null|like|between|exists|having|group|order|by|asc|desc|limit|offset|as|distinct|union|all|case|when|then|else|end|values|truncate|begin|commit|rollback)$/i
        for (const change of e.changes) {
          const typed = change.text
          // Trigger on space, newline, tab, or semicolon after keyword
          if (/^[\s;,()]$/.test(typed) && change.range.startLineNumber === change.range.endLineNumber) {
            const lineContent = model.getLineContent(change.range.startLineNumber)
            const textBefore = lineContent.substring(0, change.range.startColumn - 1)
            const match = textBefore.match(/(\w+)$/)
            if (match && SQL_KEYWORDS.test(match[1]) && match[1] !== match[1].toUpperCase()) {
              const wordStart = change.range.startColumn - match[1].length
              const range = new monacoRef.current!.Range(
                change.range.startLineNumber, wordStart,
                change.range.startLineNumber, change.range.startColumn
              )
              editor.executeEdits('autoUppercase', [{
                range,
                text: match[1].toUpperCase(),
              }])
            }
          }
        }
      }

      // ── Manual suggest trigger ──
      const word = model.getWordUntilPosition(pos)
      // Only trigger when user is actively typing a word (not on space/newline/symbol)
      if (word.word.length >= 1) {
        editor.trigger('keyboard', 'editor.action.triggerSuggest', {})
      }
    })

    // Ctrl+E → Execute
    editor.addAction({
      id: 'execute-query',
      label: 'Execute Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
      run: () => onExecute?.(),
    })

    editor.addAction({
      id: 'explain-query',
      label: 'Explain Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE],
      run: () => {
        if (explainDisabledRef.current) {
          const message = explainDisabledReasonRef.current || 'Explain is currently unavailable.'
          monaco.editor.setModelMarkers(editor.getModel()!, 'explain-query', [
            {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 1,
              message,
              severity: monaco.MarkerSeverity.Warning,
            },
          ])
          return
        }
        onExplainRef.current?.()
      },
    })

    editor.addAction({
      id: 'optimize-query',
      label: 'Optimize Query with AI',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO],
      run: () => onOptimizeRef.current?.(),
    })

    // Focus
    editor.focus()
  }

  // Cleanup
  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((d) => {
        d.dispose()
      })
      disposablesRef.current = []
    }
  }, [])

  return (
    <Editor
      height="100%"
      language={editorLanguage}
      value={value}
      onChange={(v) => onChange(v || '')}
      onMount={handleMount}
      options={{
        fontSize: settings.fontSize,
        fontFamily: "'JetBrains Mono', monospace",
        lineHeight: 28,
        padding: { top: 16, bottom: 16 },
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: settings.lineNumbers ? 'on' : 'off',
        renderLineHighlight: 'line',
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        smoothScrolling: true,
        contextmenu: true,
        automaticLayout: true,
        tabSize: settings.tabSize,
        wordWrap: settings.wordWrap ? 'on' : 'off',
        suggestOnTriggerCharacters: true,
        quickSuggestions: { other: 'on', comments: false, strings: false },
        quickSuggestionsDelay: 0,
        wordBasedSuggestions: 'off',
        suggest: {
          showKeywords: !isMongo && !isRedis,
          showSnippets: true,
          showFunctions: true,
          showStructs: true,   // TableInfo (CompletionItemKind.Struct)
          showFields: true,    // ColumnInfo (CompletionItemKind.Field)
          showInterfaces: true, // Views (CompletionItemKind.Interface)
        },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      }}
      loading={
        <div className="flex items-center justify-center h-full text-text-muted text-sm">
          Loading editor...
        </div>
      }
    />
  )
}
