package services

import (
	"bytes"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"soft-db/internal/driver"
)

func quoteIdentifier(dbType driver.DatabaseType, name string) string {
	switch dbType {
	case driver.MySQL, driver.MariaDB:
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	default:
		return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
	}
}

func formatSQLValue(dbType driver.DatabaseType, v interface{}) string {
	if v == nil {
		return "NULL"
	}
	switch val := v.(type) {
	case bool:
		switch dbType {
		case driver.PostgreSQL, driver.Redshift:
			if val {
				return "TRUE"
			}
			return "FALSE"
		default:
			if val {
				return "1"
			}
			return "0"
		}
	case []byte:
		h := hex.EncodeToString(val)
		switch dbType {
		case driver.PostgreSQL, driver.Redshift:
			return `'\x` + h + `'`
		default:
			return "X'" + h + "'"
		}
	case int:
		return fmt.Sprintf("%d", val)
	case int8:
		return fmt.Sprintf("%d", val)
	case int16:
		return fmt.Sprintf("%d", val)
	case int32:
		return fmt.Sprintf("%d", val)
	case int64:
		return fmt.Sprintf("%d", val)
	case uint:
		return fmt.Sprintf("%d", val)
	case uint8:
		return fmt.Sprintf("%d", val)
	case uint16:
		return fmt.Sprintf("%d", val)
	case uint32:
		return fmt.Sprintf("%d", val)
	case uint64:
		return fmt.Sprintf("%d", val)
	case float32:
		return fmt.Sprintf("%g", val)
	case float64:
		return fmt.Sprintf("%g", val)
	case string:
		return "'" + strings.ReplaceAll(val, "'", "''") + "'"
	default:
		return "'" + strings.ReplaceAll(fmt.Sprintf("%v", val), "'", "''") + "'"
	}
}

// SerializeRowsAsSQL generates batched INSERT INTO statements.
// NULL → SQL NULL keyword; strings are single-quoted with internal quotes doubled;
// numerics are unquoted; booleans follow dialect conventions; []byte is hex-encoded.
// batchSize ≤ 0 defaults to 500.
func SerializeRowsAsSQL(
	dbType driver.DatabaseType,
	tableName string,
	columns []string,
	rows []map[string]interface{},
	batchSize int,
) string {
	if len(rows) == 0 || len(columns) == 0 {
		return ""
	}
	if batchSize <= 0 {
		batchSize = 500
	}

	quotedTable := quoteIdentifier(dbType, tableName)
	quotedCols := make([]string, len(columns))
	for i, col := range columns {
		quotedCols[i] = quoteIdentifier(dbType, col)
	}
	colList := strings.Join(quotedCols, ", ")

	var sb strings.Builder
	for i := 0; i < len(rows); i += batchSize {
		end := i + batchSize
		if end > len(rows) {
			end = len(rows)
		}
		batch := rows[i:end]

		fmt.Fprintf(&sb, "INSERT INTO %s (%s) VALUES\n", quotedTable, colList)
		for j, row := range batch {
			vals := make([]string, len(columns))
			for k, col := range columns {
				vals[k] = formatSQLValue(dbType, row[col])
			}
			if j < len(batch)-1 {
				fmt.Fprintf(&sb, "  (%s),\n", strings.Join(vals, ", "))
			} else {
				fmt.Fprintf(&sb, "  (%s);\n", strings.Join(vals, ", "))
			}
		}
		sb.WriteByte('\n')
	}
	return sb.String()
}

// SerializeRowsAsCSV generates a CSV string with a header row.
// NULL → empty string. RFC 4180 quoting applied automatically by encoding/csv.
// delimiter empty → defaults to ','.
func SerializeRowsAsCSV(
	columns []string,
	rows []map[string]interface{},
	delimiter string,
) string {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if len(delimiter) > 0 {
		w.Comma = rune(delimiter[0])
	}
	_ = w.Write(columns)
	for _, row := range rows {
		_ = w.Write(makeCSVRecord(columns, row))
	}
	w.Flush()
	return buf.String()
}

// SerializeRowsAsJSON returns a JSON array of objects preserving Go types.
// Column order follows the columns slice.
func SerializeRowsAsJSON(
	columns []string,
	rows []map[string]interface{},
) ([]byte, error) {
	result := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		obj := make(map[string]interface{}, len(columns))
		for _, col := range columns {
			obj[col] = row[col]
		}
		result = append(result, obj)
	}
	return json.MarshalIndent(result, "", "  ")
}

// WriteChunkedExport streams table data to writer in the specified format using
// LIMIT/OFFSET pagination (chunk size 1 000 rows).
//
// Format-specific behaviours:
//   - FormatSQLInsert: each chunk produces its own INSERT statements.
//   - FormatCSV:       header is written once (first chunk only).
//   - FormatJSON:      array brackets surround all chunks; objects are comma-separated.
//
// onProgress(currentRowsProcessed, totalRows) is called after every chunk; may be nil.
func WriteChunkedExport(
	writer io.Writer,
	drv driver.ExportableDriver,
	tableName string,
	format DataExportFormat,
	dbType driver.DatabaseType,
	delimiter string,
	onProgress func(current, total int64),
) error {
	const chunkSize = 1000

	total, err := drv.GetTableRowCount(tableName)
	if err != nil {
		return fmt.Errorf("get row count for %q: %w", tableName, err)
	}

	if format == FormatJSON {
		if _, err := io.WriteString(writer, "[\n"); err != nil {
			return fmt.Errorf("write JSON open bracket: %w", err)
		}
	}

	var processedRows int64
	firstChunk := true

	for offset := 0; ; offset += chunkSize {
		result, err := drv.GetTableRows(tableName, chunkSize, offset)
		if err != nil {
			return fmt.Errorf("get rows for %q (offset %d): %w", tableName, offset, err)
		}
		if len(result.Rows) == 0 {
			break
		}

		columns := make([]string, len(result.Columns))
		for i, col := range result.Columns {
			columns[i] = col.Name
		}

		switch format {
		case FormatSQLInsert:
			sql := SerializeRowsAsSQL(dbType, tableName, columns, result.Rows, 0)
			if _, err := io.WriteString(writer, sql); err != nil {
				return fmt.Errorf("write SQL chunk: %w", err)
			}

		case FormatCSV:
			var csvData string
			if firstChunk {
				csvData = SerializeRowsAsCSV(columns, result.Rows, delimiter)
			} else {
				csvData = serializeCSVRows(columns, result.Rows, delimiter)
			}
			if _, err := io.WriteString(writer, csvData); err != nil {
				return fmt.Errorf("write CSV chunk: %w", err)
			}

		case FormatJSON:
			for i, row := range result.Rows {
				obj := make(map[string]interface{}, len(columns))
				for _, col := range columns {
					obj[col] = row[col]
				}

				b, err := json.MarshalIndent(obj, "  ", "  ")
				if err != nil {
					return fmt.Errorf("marshal JSON row: %w", err)
				}

				if !(firstChunk && i == 0) {
					if _, err := io.WriteString(writer, ",\n"); err != nil {
						return fmt.Errorf("write JSON comma: %w", err)
					}
				}
				if _, err := writer.Write(append([]byte("  "), b...)); err != nil {
					return fmt.Errorf("write JSON row: %w", err)
				}
			}
		}

		processedRows += int64(len(result.Rows))
		if onProgress != nil {
			onProgress(processedRows, total)
		}

		firstChunk = false

		if len(result.Rows) < chunkSize {
			break
		}
	}

	if format == FormatJSON {
		closingBracket := "\n]"
		if processedRows == 0 {
			closingBracket = "]"
		}
		if _, err := io.WriteString(writer, closingBracket); err != nil {
			return fmt.Errorf("write JSON close bracket: %w", err)
		}
	}

	return nil
}

func serializeCSVRows(columns []string, rows []map[string]interface{}, delimiter string) string {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if len(delimiter) > 0 {
		w.Comma = rune(delimiter[0])
	}
	for _, row := range rows {
		_ = w.Write(makeCSVRecord(columns, row))
	}
	w.Flush()
	return buf.String()
}

func makeCSVRecord(columns []string, row map[string]interface{}) []string {
	record := make([]string, len(columns))
	for i, col := range columns {
		v := row[col]
		if v == nil {
			record[i] = ""
		} else {
			record[i] = fmt.Sprintf("%v", v)
		}
	}
	return record
}
