import os
import sqlite3
from typing import List, Dict, Any

# Optional imports for PostgreSQL and MySQL – they may not be installed in the environment.
# We import lazily inside the adapter classes to avoid ImportError if the user only uses SQLite.

class DatabaseAdapter:
    """Abstract base class for database schema extraction."""

    def get_tables(self) -> List[str]:
        raise NotImplementedError

    def get_columns(self, table: str) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def get_foreign_keys(self, table: str) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def close(self):
        pass


class SQLiteAdapter(DatabaseAdapter):
    def __init__(self, db_path: str):
        if not db_path.startswith("file:") and not os.path.isfile(db_path):
            raise FileNotFoundError(f"SQLite database not found: {db_path}")
        self.conn = sqlite3.connect(db_path, uri=db_path.startswith("file:"))
        self.conn.row_factory = sqlite3.Row
        self.cur = self.conn.cursor()

    def get_tables(self) -> List[str]:
        self.cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        return [row["name"] for row in self.cur.fetchall()]

    def get_columns(self, table: str) -> List[Dict[str, Any]]:
        self.cur.execute(f"PRAGMA table_info('{table}')")
        cols = []
        for col in self.cur.fetchall():
            cols.append({
                "name": col["name"],
                "type": col["type"],
                "notnull": bool(col["notnull"]),
                "default": col["dflt_value"],
                "pk": bool(col["pk"]),
            })
        return cols

    def get_foreign_keys(self, table: str) -> List[Dict[str, Any]]:
        self.cur.execute(f"PRAGMA foreign_key_list('{table}')")
        fks = []
        for fk in self.cur.fetchall():
            fks.append({
                "from": fk["from"],
                "to_table": fk["table"],
                "to_column": fk["to"],
                "on_update": fk["on_update"],
                "on_delete": fk["on_delete"],
            })
        return fks

    def close(self):
        self.conn.close()


class PostgresAdapter(DatabaseAdapter):
    def __init__(self, conn_str: str):
        import psycopg2
        self.conn = psycopg2.connect(conn_str)
        self.cur = self.conn.cursor()

    def get_tables(self) -> List[str]:
        self.cur.execute("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")
        return [row[0] for row in self.cur.fetchall()]

    def get_columns(self, table: str) -> List[Dict[str, Any]]:
        self.cur.execute(
            """
            SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
                   (pk.column_name IS NOT NULL) AS pk
            FROM information_schema.columns AS c
            LEFT JOIN (
                SELECT kc.table_schema, kc.table_name, kc.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kc
                  ON kc.table_name = tc.table_name
                 AND kc.table_schema = tc.table_schema
                 AND kc.constraint_name = tc.constraint_name
                WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
            ) pk ON pk.table_schema = c.table_schema
               AND pk.table_name = c.table_name
               AND pk.column_name = c.column_name
            WHERE c.table_name = %s AND c.table_schema = 'public'
            """,
            (table,)
        )
        cols = []
        for row in self.cur.fetchall():
            name, dtype, nullable, default, pk = row
            cols.append({
                "name": name,
                "type": dtype,
                "notnull": nullable == 'NO',
                "default": default,
                "pk": pk,
            })
        return cols

    def get_foreign_keys(self, table: str) -> List[Dict[str, Any]]:
        self.cur.execute(
            """
            SELECT kcu.column_name AS "from",
                   ccu.table_name AS to_table,
                   ccu.column_name AS to_column,
                   rc.update_rule AS on_update,
                   rc.delete_rule AS on_delete
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.referential_constraints rc
              ON rc.constraint_name = tc.constraint_name
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = rc.unique_constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = %s;
            """,
            (table,)
        )
        fks = []
        for row in self.cur.fetchall():
            from_col, to_table, to_column, on_update, on_delete = row
            fks.append({
                "from": from_col,
                "to_table": to_table,
                "to_column": to_column,
                "on_update": on_update,
                "on_delete": on_delete,
            })
        return fks

    def close(self):
        self.conn.close()


class MySQLAdapter(DatabaseAdapter):
    def __init__(self, conn_str: str):
        import mysql.connector
        # conn_str format: "user:password@host:port/database"
        # Very simple parser – in production use urllib.parse
        import re
        m = re.match(r"(?P<user>[^:]+):(?P<pwd>[^@]+)@(?P<host>[^:]+):(?P<port>\d+)/(?P<db>.+)", conn_str)
        if not m:
            raise ValueError('Invalid MySQL connection string')
        cfg = m.groupdict()
        self.conn = mysql.connector.connect(
            host=cfg['host'],
            port=int(cfg['port']),
            user=cfg['user'],
            password=cfg['pwd'],
            database=cfg['db'],
        )
        self.cur = self.conn.cursor(dictionary=True)

    def get_tables(self) -> List[str]:
        self.cur.execute("SHOW TABLES")
        return [next(iter(row.values())) for row in self.cur.fetchall()]

    def get_columns(self, table: str) -> List[Dict[str, Any]]:
        self.cur.execute(f"SHOW COLUMNS FROM `{table}`")
        cols = []
        for row in self.cur.fetchall():
            cols.append({
                "name": row['Field'],
                "type": row['Type'],
                "notnull": row['Null'] == 'NO',
                "default": row['Default'],
                "pk": row['Key'] == 'PRI',
            })
        return cols

    def get_foreign_keys(self, table: str) -> List[Dict[str, Any]]:
        self.cur.execute(
            "SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, UPDATE_RULE, DELETE_RULE "
            "FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k "
            "JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r "
            "ON k.CONSTRAINT_NAME = r.CONSTRAINT_NAME "
            "WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = %s AND k.REFERENCED_TABLE_NAME IS NOT NULL",
            (table,)
        )
        fks = []
        for row in self.cur.fetchall():
            fks.append({
                "from": row['COLUMN_NAME'],
                "to_table": row['REFERENCED_TABLE_NAME'],
                "to_column": row['REFERENCED_COLUMN_NAME'],
                "on_update": row['UPDATE_RULE'],
                "on_delete": row['DELETE_RULE'],
            })
        return fks

    def close(self):
        self.conn.close()


def get_adapter(db_type: str, conn_str: str) -> DatabaseAdapter:
    """Factory returning the appropriate adapter.
    db_type: 'sqlite', 'postgres', or 'mysql'.
    conn_str: for sqlite – file path; for others – connection string.
    """
    db_type = db_type.lower()
    if db_type == 'sqlite':
        return SQLiteAdapter(conn_str)
    if db_type == 'postgres':
        return PostgresAdapter(conn_str)
    if db_type == 'mysql':
        return MySQLAdapter(conn_str)
    raise ValueError(f'Unsupported db_type: {db_type}')
