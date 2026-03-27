package services

import (
	"strings"
	"testing"

	"soft-db/internal/driver"
)

func TestDDLQuoteIdentifier(t *testing.T) {
	cases := []struct {
		dbType driver.DatabaseType
		input  string
		want   string
	}{
		{driver.MySQL, "users", "`users`"},
		{driver.MariaDB, "orders", "`orders`"},
		{driver.PostgreSQL, "users", `"users"`},
		{driver.SQLite, "my_table", `"my_table"`},
		{driver.Redshift, "events", `"events"`},
		{driver.MySQL, "weird`name", "`weird``name`"},
		{driver.PostgreSQL, `say"hi`, `"say""hi"`},
	}
	for _, tc := range cases {
		got := QuoteIdentifier(tc.dbType, tc.input)
		if got != tc.want {
			t.Errorf("QuoteIdentifier(%s, %q) = %q; want %q", tc.dbType, tc.input, got, tc.want)
		}
	}
}

func TestDDLDropTable(t *testing.T) {
	cases := []struct {
		dbType driver.DatabaseType
		table  string
		want   string
	}{
		{driver.MySQL, "users", "DROP TABLE IF EXISTS `users`;"},
		{driver.PostgreSQL, "users", `DROP TABLE IF EXISTS "users";`},
		{driver.SQLite, "logs", `DROP TABLE IF EXISTS "logs";`},
		{driver.Redshift, "events", `DROP TABLE IF EXISTS "events";`},
		{driver.MariaDB, "orders", "DROP TABLE IF EXISTS `orders`;"},
	}
	for _, tc := range cases {
		got := GenerateDropTableDDL(tc.dbType, tc.table)
		if got != tc.want {
			t.Errorf("GenerateDropTableDDL(%s, %q) = %q; want %q", tc.dbType, tc.table, got, tc.want)
		}
	}
}

func TestDDLCreateTableMySQL(t *testing.T) {
	cols := []driver.ColumnInfo{
		{Name: "id", Type: "INT", Nullable: false, PrimaryKey: true, OrdinalPos: 1},
		{Name: "email", Type: "VARCHAR(255)", Nullable: false, Unique: true, OrdinalPos: 2},
		{Name: "name", Type: "VARCHAR(100)", Nullable: true, OrdinalPos: 3},
		{Name: "score", Type: "INT", Nullable: true, DefaultValue: "0", OrdinalPos: 4},
		{Name: "created_at", Type: "DATETIME", Nullable: false, DefaultValue: "CURRENT_TIMESTAMP", OrdinalPos: 5},
	}

	ddl := GenerateCreateTableDDL(driver.MySQL, "users", cols, false)

	mustContain(t, ddl, "CREATE TABLE `users`")
	mustContain(t, ddl, "`id` INT NOT NULL PRIMARY KEY")
	mustContain(t, ddl, "`email` VARCHAR(255) NOT NULL UNIQUE")
	mustContain(t, ddl, "`name` VARCHAR(100)")
	mustContain(t, ddl, "DEFAULT 0")
	mustContain(t, ddl, "DEFAULT CURRENT_TIMESTAMP")
	mustContain(t, ddl, "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;")
	mustNotContain(t, ddl, "CREATE TABLE IF NOT EXISTS")
}

func TestDDLCreateTableMySQLIfNotExists(t *testing.T) {
	cols := []driver.ColumnInfo{
		{Name: "id", Type: "INT", Nullable: false, PrimaryKey: true, OrdinalPos: 1},
	}
	ddl := GenerateCreateTableDDL(driver.MySQL, "users", cols, true)
	mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS `users`")
}

func TestDDLCreateTablePostgreSQL(t *testing.T) {
	cols := []driver.ColumnInfo{
		{Name: "id", Type: "SERIAL", Nullable: false, PrimaryKey: true, OrdinalPos: 1},
		{Name: "username", Type: "TEXT", Nullable: false, Unique: true, OrdinalPos: 2},
		{Name: "bio", Type: "TEXT", Nullable: true, OrdinalPos: 3},
		{Name: "points", Type: "INTEGER", Nullable: false, DefaultValue: "100", OrdinalPos: 4},
	}

	ddl := GenerateCreateTableDDL(driver.PostgreSQL, "users", cols, false)

	mustContain(t, ddl, `CREATE TABLE "users"`)
	mustContain(t, ddl, `"id" SERIAL NOT NULL PRIMARY KEY`)
	mustContain(t, ddl, `"username" TEXT NOT NULL UNIQUE`)
	mustContain(t, ddl, `"bio" TEXT`)
	mustContain(t, ddl, "DEFAULT 100")
	mustNotContain(t, ddl, "ENGINE=")
	if !strings.HasSuffix(strings.TrimSpace(ddl), ";") {
		t.Errorf("PostgreSQL DDL should end with ';'")
	}
}

func TestDDLCreateTableSQLite(t *testing.T) {
	cols := []driver.ColumnInfo{
		{Name: "id", Type: "INTEGER", Nullable: false, PrimaryKey: true, OrdinalPos: 1},
		{Name: "title", Type: "TEXT", Nullable: false, OrdinalPos: 2},
	}

	ddl := GenerateCreateTableDDL(driver.SQLite, "notes", cols, false)

	mustContain(t, ddl, `CREATE TABLE "notes"`)
	mustContain(t, ddl, `"id" INTEGER NOT NULL PRIMARY KEY`)
	mustContain(t, ddl, `"title" TEXT NOT NULL`)
	mustNotContain(t, ddl, "ENGINE=")
}

func TestDDLCreateTableRedshift(t *testing.T) {
	cols := []driver.ColumnInfo{
		{Name: "event_id", Type: "BIGINT", Nullable: false, PrimaryKey: true, OrdinalPos: 1},
		{Name: "payload", Type: "VARCHAR(65535)", Nullable: true, OrdinalPos: 2},
	}

	ddl := GenerateCreateTableDDL(driver.Redshift, "events", cols, false)

	mustContain(t, ddl, `CREATE TABLE "events"`)
	mustContain(t, ddl, `"event_id" BIGINT NOT NULL PRIMARY KEY`)
	mustNotContain(t, ddl, "ENGINE=")
}

func TestDDLCreateTableCompositePK(t *testing.T) {
	cols := []driver.ColumnInfo{
		{Name: "user_id", Type: "INT", Nullable: false, PrimaryKey: true, OrdinalPos: 1},
		{Name: "role_id", Type: "INT", Nullable: false, PrimaryKey: true, OrdinalPos: 2},
		{Name: "granted_at", Type: "DATETIME", Nullable: true, OrdinalPos: 3},
	}

	ddl := GenerateCreateTableDDL(driver.MySQL, "user_roles", cols, false)

	mustNotContain(t, ddl, "`user_id` INT NOT NULL PRIMARY KEY")
	mustNotContain(t, ddl, "`role_id` INT NOT NULL PRIMARY KEY")
	mustContain(t, ddl, "PRIMARY KEY (`user_id`, `role_id`)")
}

func TestDDLCreateTableDefaultValueQuoting(t *testing.T) {
	cols := []driver.ColumnInfo{
		{Name: "a", Type: "INT", Nullable: true, DefaultValue: "42", OrdinalPos: 1},
		{Name: "b", Type: "FLOAT", Nullable: true, DefaultValue: "3.14", OrdinalPos: 2},
		{Name: "c", Type: "VARCHAR(10)", Nullable: true, DefaultValue: "hello", OrdinalPos: 3},
		{Name: "d", Type: "TEXT", Nullable: true, DefaultValue: "NULL", OrdinalPos: 4},
		{Name: "e", Type: "BOOLEAN", Nullable: true, DefaultValue: "TRUE", OrdinalPos: 5},
		{Name: "f", Type: "TEXT", Nullable: true, DefaultValue: "'already quoted'", OrdinalPos: 6},
		{Name: "g", Type: "TEXT", Nullable: true, DefaultValue: "it's fine", OrdinalPos: 7},
	}

	ddl := GenerateCreateTableDDL(driver.PostgreSQL, "t", cols, false)

	mustContain(t, ddl, "DEFAULT 42")
	mustContain(t, ddl, "DEFAULT 3.14")
	mustContain(t, ddl, "DEFAULT 'hello'")
	mustContain(t, ddl, "DEFAULT NULL")
	mustContain(t, ddl, "DEFAULT TRUE")
	mustContain(t, ddl, "DEFAULT 'already quoted'")
	mustContain(t, ddl, "DEFAULT 'it''s fine'")
}

func mustContain(t *testing.T, s, sub string) {
	t.Helper()
	if !strings.Contains(s, sub) {
		t.Errorf("expected DDL to contain %q\n\nGot:\n%s", sub, s)
	}
}

func mustNotContain(t *testing.T, s, sub string) {
	t.Helper()
	if strings.Contains(s, sub) {
		t.Errorf("expected DDL NOT to contain %q\n\nGot:\n%s", sub, s)
	}
}
