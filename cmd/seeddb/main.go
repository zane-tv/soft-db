package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "modernc.org/sqlite"
)

func main() {
	dbPath := "testdata/sample.db"
	os.MkdirAll("testdata", 0755)
	os.Remove(dbPath) // fresh start

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// ─── Create Tables ───
	stmts := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL UNIQUE,
			full_name TEXT NOT NULL,
			role TEXT DEFAULT 'user',
			active INTEGER DEFAULT 1,
			created_at TEXT DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			price REAL NOT NULL,
			stock INTEGER DEFAULT 0,
			category TEXT,
			created_at TEXT DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE orders (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id),
			product_id INTEGER NOT NULL REFERENCES products(id),
			quantity INTEGER NOT NULL DEFAULT 1,
			total REAL NOT NULL,
			status TEXT DEFAULT 'pending',
			created_at TEXT DEFAULT (datetime('now'))
		)`,
		`CREATE VIEW active_users AS
			SELECT id, email, full_name, role FROM users WHERE active = 1`,
	}

	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			log.Fatalf("SQL error: %v\n%s", err, s)
		}
	}

	// ─── Seed Data ───
	users := []struct{ email, name, role string }{
		{"alice@example.com", "Alice Johnson", "admin"},
		{"bob@example.com", "Bob Smith", "user"},
		{"charlie@example.com", "Charlie Brown", "user"},
		{"diana@example.com", "Diana Prince", "moderator"},
		{"eve@example.com", "Eve Williams", "user"},
		{"frank@example.com", "Frank Castle", "user"},
		{"grace@example.com", "Grace Hopper", "admin"},
		{"henry@example.com", "Henry Ford", "user"},
	}
	for _, u := range users {
		db.Exec("INSERT INTO users (email, full_name, role) VALUES (?, ?, ?)", u.email, u.name, u.role)
	}

	products := []struct {
		name     string
		price    float64
		stock    int
		category string
	}{
		{"Laptop Pro 16\"", 1299.99, 45, "Electronics"},
		{"Wireless Mouse", 29.99, 200, "Electronics"},
		{"Standing Desk", 499.00, 30, "Furniture"},
		{"Mechanical Keyboard", 149.99, 80, "Electronics"},
		{"Monitor 27\" 4K", 399.99, 60, "Electronics"},
		{"Office Chair", 299.00, 25, "Furniture"},
		{"USB-C Hub", 49.99, 150, "Accessories"},
		{"Webcam HD", 79.99, 100, "Electronics"},
		{"Desk Lamp LED", 39.99, 120, "Accessories"},
		{"Noise Cancelling Headphones", 249.99, 55, "Electronics"},
	}
	for _, p := range products {
		db.Exec("INSERT INTO products (name, price, stock, category) VALUES (?, ?, ?, ?)", p.name, p.price, p.stock, p.category)
	}

	orders := []struct {
		userID, productID, qty int
		total                  float64
		status                 string
	}{
		{1, 1, 1, 1299.99, "completed"},
		{2, 2, 2, 59.98, "completed"},
		{3, 3, 1, 499.00, "pending"},
		{1, 4, 1, 149.99, "completed"},
		{4, 5, 2, 799.98, "shipped"},
		{5, 6, 1, 299.00, "pending"},
		{2, 7, 3, 149.97, "completed"},
		{6, 8, 1, 79.99, "shipped"},
		{7, 1, 1, 1299.99, "completed"},
		{3, 10, 1, 249.99, "pending"},
		{8, 9, 2, 79.98, "completed"},
		{1, 2, 5, 149.95, "completed"},
	}
	for _, o := range orders {
		db.Exec("INSERT INTO orders (user_id, product_id, quantity, total, status) VALUES (?, ?, ?, ?, ?)",
			o.userID, o.productID, o.qty, o.total, o.status)
	}

	fmt.Printf("✅ Created %s with:\n", dbPath)
	fmt.Println("   • 3 tables: users (8 rows), products (10 rows), orders (12 rows)")
	fmt.Println("   • 1 view: active_users")
}
