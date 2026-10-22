import os
import sqlite3


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_DATABASE_PATH = os.path.join(PROJECT_ROOT, "sample.db")
DEMO_BASELINE_PATH = os.path.join(PROJECT_ROOT, "demo_baseline.db")
DEMO_TARGET_PATH = os.path.join(PROJECT_ROOT, "demo_target.db")


def _has_user_tables(connection: sqlite3.Connection) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
    ).fetchone()
    return row is not None


def ensure_sample_database(db_path: str = DEFAULT_DATABASE_PATH) -> None:
    """Populate an empty demo database without altering an existing database."""
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        if _has_user_tables(connection):
            return
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(
            """
            CREATE TABLE departments (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE
            );
            CREATE TABLE customers (
                id INTEGER PRIMARY KEY,
                department_id INTEGER REFERENCES departments(id),
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE products (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                price REAL NOT NULL CHECK (price >= 0),
                stock INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE orders (
                id INTEGER PRIMARY KEY,
                customer_id INTEGER NOT NULL REFERENCES customers(id),
                status TEXT NOT NULL DEFAULT 'pending',
                total REAL NOT NULL,
                placed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE order_items (
                id INTEGER PRIMARY KEY,
                order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(id),
                quantity INTEGER NOT NULL DEFAULT 1,
                unit_price REAL NOT NULL
            );
            CREATE TABLE audit_log (
                event TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO departments (id, name) VALUES
                (1, 'Engineering'), (2, 'Operations');
            INSERT INTO customers (id, department_id, name, email) VALUES
                (1, 1, 'Avery Chen', 'avery@example.test'),
                (2, 2, 'Jordan Rivera', 'jordan@example.test'),
                (3, 1, 'Sam Patel', 'sam@example.test');
            INSERT INTO products (id, name, price, stock) VALUES
                (1, 'Wireless Keyboard', 79.99, 24),
                (2, 'USB-C Dock', 149.50, 11),
                (3, 'Desk Lamp', 42.00, 38);
            INSERT INTO orders (id, customer_id, status, total) VALUES
                (1, 1, 'shipped', 229.49),
                (2, 2, 'pending', 42.00),
                (3, 3, 'processing', 79.99);
            INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES
                (1, 1, 1, 1, 79.99), (2, 1, 2, 1, 149.50),
                (3, 2, 3, 1, 42.00), (4, 3, 1, 1, 79.99);
            INSERT INTO audit_log (event, entity_type, entity_id) VALUES
                ('created', 'order', 1), ('updated', 'order', 2);
            """
        )


def _create_migration_database(db_path: str, target: bool) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        if _has_user_tables(connection):
            return
        if target:
            schema = """
            CREATE TABLE customers (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE
            );
            CREATE TABLE orders (
                id INTEGER PRIMARY KEY,
                customer_id INTEGER NOT NULL REFERENCES customers(id),
                total NUMERIC NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending'
            );
            CREATE TABLE shipments (
                id INTEGER PRIMARY KEY,
                order_id INTEGER NOT NULL REFERENCES orders(id),
                tracking_code TEXT NOT NULL
            );
            """
        else:
            schema = """
            CREATE TABLE customers (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                legacy_segment TEXT
            );
            CREATE TABLE orders (
                id INTEGER PRIMARY KEY,
                customer_id INTEGER NOT NULL REFERENCES customers(id),
                total REAL NOT NULL
            );
            """
        connection.executescript(schema)


def ensure_demo_migration_databases() -> None:
    """Create baseline and target examples only when the files are empty."""
    _create_migration_database(DEMO_BASELINE_PATH, target=False)
    _create_migration_database(DEMO_TARGET_PATH, target=True)
