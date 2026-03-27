package services

import (
	"fmt"
	"strconv"
	"strings"

	"soft-db/internal/driver"
)

// QuoteIdentifier wraps a name in the dialect-appropriate quoting characters.
// MySQL/MariaDB: backticks. PostgreSQL, SQLite, Redshift: double-quotes.
func QuoteIdentifier(dbType driver.DatabaseType, name string) string {
	switch dbType {
	case driver.MySQL, driver.MariaDB:
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	default:
		return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
	}
}

// GenerateCreateTableDDL builds a CREATE TABLE (or CREATE TABLE IF NOT EXISTS) statement
// for the given dialect from ColumnInfo. Multi-column PKs produce a trailing constraint;
// single-column PKs are rendered inline. MySQL/MariaDB append ENGINE=InnoDB DEFAULT CHARSET=utf8mb4.
func GenerateCreateTableDDL(dbType driver.DatabaseType, tableName string, columns []driver.ColumnInfo, ifNotExists bool) string {
	keyword := "CREATE TABLE"
	if ifNotExists {
		keyword = "CREATE TABLE IF NOT EXISTS"
	}

	var pkCols []string
	for _, col := range columns {
		if col.PrimaryKey {
			pkCols = append(pkCols, col.Name)
		}
	}
	multiPK := len(pkCols) > 1

	defs := make([]string, 0, len(columns)+1)
	for _, col := range columns {
		defs = append(defs, buildDDLColumnDef(dbType, col, multiPK))
	}

	if multiPK {
		quoted := make([]string, len(pkCols))
		for i, name := range pkCols {
			quoted[i] = QuoteIdentifier(dbType, name)
		}
		defs = append(defs, fmt.Sprintf("PRIMARY KEY (%s)", strings.Join(quoted, ", ")))
	}

	head := fmt.Sprintf("%s %s (\n  %s\n)", keyword, QuoteIdentifier(dbType, tableName), strings.Join(defs, ",\n  "))

	switch dbType {
	case driver.MySQL, driver.MariaDB:
		return head + " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
	default:
		return head + ";"
	}
}

// GenerateDropTableDDL returns a DROP TABLE IF EXISTS statement for the given dialect.
func GenerateDropTableDDL(dbType driver.DatabaseType, tableName string) string {
	return fmt.Sprintf("DROP TABLE IF EXISTS %s;", QuoteIdentifier(dbType, tableName))
}

func buildDDLColumnDef(dbType driver.DatabaseType, col driver.ColumnInfo, multiPK bool) string {
	parts := []string{QuoteIdentifier(dbType, col.Name), col.Type}

	if !col.Nullable {
		parts = append(parts, "NOT NULL")
	}
	if col.PrimaryKey && !multiPK {
		parts = append(parts, "PRIMARY KEY")
	}
	if col.Unique && !col.PrimaryKey {
		parts = append(parts, "UNIQUE")
	}
	if dv := strings.TrimSpace(col.DefaultValue); dv != "" {
		parts = append(parts, "DEFAULT "+quoteDDLDefault(dv))
	}

	return strings.Join(parts, " ")
}

func quoteDDLDefault(raw string) string {
	if strings.HasPrefix(raw, "'") && strings.HasSuffix(raw, "'") {
		return raw
	}
	if _, err := strconv.ParseInt(raw, 10, 64); err == nil {
		return raw
	}
	if _, err := strconv.ParseFloat(raw, 64); err == nil {
		return raw
	}

	upper := strings.ToUpper(raw)
	for _, kw := range []string{
		"NULL", "TRUE", "FALSE",
		"CURRENT_TIMESTAMP", "CURRENT_DATE", "CURRENT_TIME",
		"NOW()", "GETDATE()", "SYSDATE()",
		"CURRENT_USER", "CURRENT_USER()",
	} {
		if upper == kw {
			return raw
		}
	}
	if strings.HasSuffix(raw, ")") && strings.Contains(raw, "(") {
		return raw
	}

	return "'" + strings.ReplaceAll(raw, "'", "''") + "'"
}
