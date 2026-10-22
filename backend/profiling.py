import sqlite3


def quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def profile_table(db_path: str, table_name: str) -> dict:
    """Return row count and NULL statistics for an existing SQLite table."""
    with sqlite3.connect(db_path, uri=db_path.startswith("file:")) as connection:
        exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table_name,),
        ).fetchone()
        if exists is None:
            raise LookupError(f"Table not found: {table_name}")

        quoted_table = quote_identifier(table_name)
        row_count = connection.execute(
            f"SELECT COUNT(*) FROM {quoted_table}"
        ).fetchone()[0]
        columns = [
            row[1]
            for row in connection.execute(f"PRAGMA table_info({quoted_table})")
        ]
        null_stats = {}
        for column in columns:
            quoted_column = quote_identifier(column)
            null_count = connection.execute(
                f"SELECT COUNT(*) FROM {quoted_table} WHERE {quoted_column} IS NULL"
            ).fetchone()[0]
            null_stats[column] = {
                "null_count": null_count,
                "null_percent": (null_count / row_count * 100) if row_count else 0,
            }
    return {"table": table_name, "row_count": row_count, "null_stats": null_stats}
