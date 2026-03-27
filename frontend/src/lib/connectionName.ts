const DB_TYPE_LABELS: Record<string, string> = {
  mysql: 'MySQL', mariadb: 'MariaDB', postgresql: 'PostgreSQL',
  sqlite: 'SQLite', mongodb: 'MongoDB', redshift: 'Redshift', redis: 'Redis',
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function getMongoHost(uri: string): string | null {
  const trimmedUri = uri.trim()
  const withoutProtocol = trimmedUri.replace(/^mongodb(?:\+srv)?:\/\//i, '')

  if (!withoutProtocol || withoutProtocol === trimmedUri) {
    return null
  }

  const authority = withoutProtocol.split(/[/?#]/)[0]?.trim()
  if (!authority) {
    return null
  }

  const hostSection = authority.includes('@') ? authority.split('@').pop() : authority
  const firstHost = hostSection?.split(',')[0]?.trim()
  if (!firstHost) {
    return null
  }

  if (firstHost.startsWith('[')) {
    const closingBracketIndex = firstHost.indexOf(']')
    return closingBracketIndex > 0 ? firstHost.slice(1, closingBracketIndex) : null
  }

  return firstHost.split(':')[0]?.trim() || null
}

function getSqliteFilename(filePath: string): string {
  const trimmedPath = filePath.trim()
  if (!trimmedPath) {
    return ''
  }

  const segments = trimmedPath.split(/[/\\]/)
  return segments[segments.length - 1] || ''
}

export function generateConnectionName(
  type: string,
  host: string,
  port: string,
  filePath: string,
  uri: string,
  database?: string,
): string {
  if (type === 'sqlite') {
    const filename = getSqliteFilename(filePath)
    if (filename) {
      return `SQLite@${filename}`
    }

    const sqliteTarget = database?.trim() || 'new'
    return `SQLite@${sqliteTarget}`
  }

  if (type === 'mongodb' && uri.trim()) {
    const mongoHost = getMongoHost(uri)
    if (mongoHost) {
      return `MongoDB@${mongoHost}`
    }

    return `MongoDB@${truncate(uri.trim(), 30)}`
  }

  const label = DB_TYPE_LABELS[type] || type
  const normalizedHost = host.trim() || 'localhost'
  const normalizedPort = port.trim()
  const hasPort = normalizedPort !== '' && normalizedPort !== '0'
  const baseName = `${label}@${normalizedHost}${hasPort ? `:${normalizedPort}` : ''}`

  if (type === 'redis') {
    const normalizedDatabase = database?.trim()
    if (normalizedDatabase && normalizedDatabase !== '0') {
      return `${baseName}/${normalizedDatabase}`
    }
  }

  return baseName
}
