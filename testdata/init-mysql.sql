CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    age INT,
    salary DECIMAL(10,2),
    is_active BOOLEAN DEFAULT TRUE,
    bio TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    category VARCHAR(100),
    stock INT DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    total DECIMAL(10,2) NOT NULL,
    status ENUM('pending','processing','shipped','delivered','cancelled') DEFAULT 'pending',
    ordered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO users (name, email, age, salary, is_active, bio) VALUES
('Nguyen Van A', 'a@example.com', 28, 1500.00, TRUE, 'Backend developer'),
('Tran Thi B', 'b@example.com', 32, 2200.50, TRUE, 'Frontend lead'),
('Le Van C', 'c@example.com', 25, 1200.00, FALSE, NULL),
('Pham Thi D', 'd@example.com', 40, 3500.75, TRUE, 'CTO at startup'),
('Hoang Van E', 'e@example.com', 22, 900.00, TRUE, 'Junior intern');

INSERT INTO products (name, price, category, stock, description) VALUES
('Laptop Dell XPS 15', 1299.99, 'Electronics', 50, 'High-end laptop'),
('Mechanical Keyboard', 89.99, 'Accessories', 200, 'Cherry MX switches'),
('USB-C Hub', 45.00, 'Accessories', 150, '7-in-1 hub'),
('Monitor 27"', 399.00, 'Electronics', 30, '4K IPS display'),
('Mouse Logitech MX', 79.99, 'Accessories', 100, 'Wireless ergonomic');

INSERT INTO orders (user_id, product_id, quantity, total, status) VALUES
(1, 1, 1, 1299.99, 'delivered'),
(1, 2, 2, 179.98, 'shipped'),
(2, 3, 1, 45.00, 'processing'),
(3, 4, 1, 399.00, 'pending'),
(4, 5, 3, 239.97, 'delivered'),
(5, 1, 1, 1299.99, 'cancelled'),
(2, 2, 1, 89.99, 'delivered');
