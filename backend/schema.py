import sqlite3
import os
from typing import List, Dict, Any


def get_schema(db_path: str) -> List[Dict[str, Any]]:
    """Return a list of tables with their columns, keys, indexes, and foreign keys.

    Each table entry is a dict:
        {
            "name": str,
            "columns": [
                {"name": str, "type": str, "notnull": bool, "default": Any, "pk": bool},
                ...
            ],
            "indexes": [
                {"name": str, "columns": List[str], "unique": bool, "origin": str, "partial": bool},
                ...
            ],
            "foreign_keys": [
                {"from": str, "to_table": str, "to_column": str, "on_update": str, "on_delete": str},
                ...
            ]
        }
    """
    if not db_path.startswith("file:") and not os.path.isfile(db_path):
        raise FileNotFoundError(f"SQLite database not found: {db_path}")
    conn = sqlite3.connect(db_path, uri=db_path.startswith("file:"))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Get list of user tables
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    tables = [row["name"] for row in cur.fetchall()]

    schema = []
    for tbl in tables:
        # Columns
        table_literal = tbl.replace("'", "''")
        cur.execute(f"PRAGMA table_info('{table_literal}')")
        cols = []
        for col in cur.fetchall():
            cols.append({
                "name": col["name"],
                "type": col["type"],
                "notnull": bool(col["notnull"]),
                "default": col["dflt_value"],
                "pk": bool(col["pk"]),
            })
        # Foreign keys
        cur.execute(f"PRAGMA foreign_key_list('{table_literal}')")
        fks = []
        for fk in cur.fetchall():
            fks.append({
                "from": fk["from"],
                "to_table": fk["table"],
                "to_column": fk["to"],
                "on_update": fk["on_update"],
                "on_delete": fk["on_delete"],
            })
        cur.execute(f"PRAGMA index_list('{table_literal}')")
        indexes = []
        for index in cur.fetchall():
            index_name = index["name"]
            index_literal = index_name.replace("'", "''")
            cur.execute(f"PRAGMA index_info('{index_literal}')")
            indexes.append({
                "name": index_name,
                "columns": [column["name"] or "<expression>" for column in cur.fetchall()],
                "unique": bool(index["unique"]),
                "origin": index["origin"],
                "partial": bool(index["partial"]),
            })
        schema.append({
            "name": tbl,
            "columns": cols,
            "indexes": indexes,
            "foreign_keys": fks,
        })
    conn.close()
    return schema
