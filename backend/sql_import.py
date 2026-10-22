import sqlite3
import threading
import time
import uuid
from typing import Any

from .schema import get_schema

MAX_SQL_CHARACTERS = 200_000
MAX_DATABASE_PAGES = 8_192
MAX_EXECUTION_SECONDS = 5
MAX_SQLITE_STEPS = 1_000_000

_lock = threading.RLock()
_active_connection: sqlite3.Connection | None = None
_active_uri: str | None = None
_active_metadata: dict[str, Any] | None = None


def _sql_authorizer(action: int, first: str | None, second: str | None, database: str | None, source: str | None) -> int:
    allowed_actions = {
        sqlite3.SQLITE_CREATE_TABLE,
        sqlite3.SQLITE_CREATE_INDEX,
        sqlite3.SQLITE_READ,
        sqlite3.SQLITE_SELECT,
        sqlite3.SQLITE_TRANSACTION,
        sqlite3.SQLITE_SAVEPOINT,
        sqlite3.SQLITE_REINDEX,
        sqlite3.SQLITE_DROP_TABLE,
        sqlite3.SQLITE_DROP_INDEX,
        sqlite3.SQLITE_ALTER_TABLE,
    }

    if action in {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE}:
        return sqlite3.SQLITE_OK if database == "main" else sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_PRAGMA:
        return (
            sqlite3.SQLITE_OK
            if first and first.lower() in {"foreign_keys", "defer_foreign_keys"}
            else sqlite3.SQLITE_DENY
        )
    if action == sqlite3.SQLITE_FUNCTION:
        function_name = (second or first or "").lower()
        return (
            sqlite3.SQLITE_DENY
            if function_name in {"load_extension", "readfile", "writefile", "fts3_tokenizer"}
            else sqlite3.SQLITE_OK
        )
    if action in allowed_actions:
        if action in {
            sqlite3.SQLITE_CREATE_TABLE,
            sqlite3.SQLITE_CREATE_INDEX,
            sqlite3.SQLITE_DROP_TABLE,
            sqlite3.SQLITE_DROP_INDEX,
        }:
            return sqlite3.SQLITE_OK if database == "main" else sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_ALTER_TABLE:
            return sqlite3.SQLITE_OK if first == "main" else sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


def get_active_database_uri() -> str | None:
    with _lock:
        return _active_uri


def get_active_database_info() -> dict[str, Any]:
    with _lock:
        if _active_metadata is not None:
            return dict(_active_metadata)
    return {"source": "Local SQLite sample database", "imported": False}


def reset_sqlite_import() -> dict[str, Any]:
    """Stop using the imported in-memory database and restore the configured source."""
    global _active_connection, _active_uri, _active_metadata

    with _lock:
        if _active_connection is not None:
            _active_connection.close()
        _active_connection = None
        _active_uri = None
        _active_metadata = None
    return get_active_database_info()


def import_sqlite_script(sql: str) -> dict[str, Any]:
    """Validate a pasted SQLite schema/data script in a private in-memory database."""
    global _active_connection, _active_uri, _active_metadata

    if not isinstance(sql, str) or not sql.strip():
        raise ValueError("Paste SQLite SQL before importing it.")
    if len(sql) > MAX_SQL_CHARACTERS:
        raise ValueError(f"SQL input is limited to {MAX_SQL_CHARACTERS:,} characters.")
    if "\x00" in sql:
        raise ValueError("SQL input cannot contain null characters.")

    uri = f"file:schemasphere-import-{uuid.uuid4().hex}?mode=memory&cache=shared"
    candidate = sqlite3.connect(uri, uri=True, check_same_thread=False)
    started_at = time.monotonic()
    steps = 0

    def interrupt_if_over_budget() -> int:
        nonlocal steps
        steps += 1_000
        return int(
            steps > MAX_SQLITE_STEPS
            or time.monotonic() - started_at > MAX_EXECUTION_SECONDS
        )

    try:
        candidate.execute("PRAGMA foreign_keys = ON")
        candidate.execute(f"PRAGMA max_page_count = {MAX_DATABASE_PAGES}")
        candidate.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, MAX_SQL_CHARACTERS)
        candidate.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1_000_000)
        candidate.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 200)
        candidate.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT, 10)
        candidate.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH, 50)
        candidate.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
        candidate.setlimit(sqlite3.SQLITE_LIMIT_TRIGGER_DEPTH, 0)
        candidate.set_authorizer(_sql_authorizer)
        candidate.set_progress_handler(interrupt_if_over_budget, 1_000)
        candidate.executescript(sql)
        candidate.set_progress_handler(None, 0)
        candidate.set_authorizer(None)

        foreign_key_errors = candidate.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_errors:
            raise ValueError(
                f"SQL imported with {len(foreign_key_errors)} foreign-key violation(s)."
            )

        schema = get_schema(uri)
        if not schema:
            raise ValueError("The script did not create any user tables.")

        table_count = len(schema)
        column_count = sum(len(table["columns"]) for table in schema)
        row_count = sum(
            candidate.execute(
                f'SELECT COUNT(*) FROM "{table["name"].replace(chr(34), chr(34) * 2)}"'
            ).fetchone()[0]
            for table in schema
        )
        candidate.execute("PRAGMA query_only = ON")
        candidate.set_authorizer(_sql_authorizer)
        metadata = {
            "source": "Pasted SQL · temporary isolated database",
            "imported": True,
            "tables": table_count,
            "columns": column_count,
            "rows": row_count,
        }

        with _lock:
            previous = _active_connection
            _active_connection = candidate
            _active_uri = uri
            _active_metadata = metadata
            candidate = None
            if previous is not None:
                previous.close()
        return metadata
    except sqlite3.Error as error:
        if "interrupted" in str(error).lower():
            raise ValueError(
                "SQL exceeded the temporary import time or work limit. Simplify the script and try again."
            ) from error
        raise ValueError(
            f"SQL could not be imported: {error}. Supported statements include CREATE, ALTER, and DROP for tables/indexes plus INSERT, UPDATE, DELETE, and SELECT. Attached databases, triggers, views, and external access are blocked."
        ) from error
    finally:
        if candidate is not None:
            candidate.close()
