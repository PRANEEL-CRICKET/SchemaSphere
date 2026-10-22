import datetime
import json
import os

from .db_adapter import get_adapter

SNAPSHOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "snapshots"))
os.makedirs(SNAPSHOT_DIR, exist_ok=True)


def _snapshot_schema(db_path: str) -> list:
    adapter = get_adapter("sqlite", db_path)
    try:
        return [
            {
                "name": table,
                "columns": adapter.get_columns(table),
                "foreign_keys": adapter.get_foreign_keys(table),
            }
            for table in adapter.get_tables()
        ]
    finally:
        adapter.close()


def _write_snapshot(db_path: str, schema: list, baseline: bool = False) -> dict:
    timestamp = datetime.datetime.now(datetime.timezone.utc)
    database_name = (
        "pasted-sql"
        if db_path.startswith("file:schemasphere-import-")
        else os.path.basename(db_path.split("?", 1)[0])
    )
    if baseline:
        filename = f"{database_name}_baseline.json"
    else:
        filename = f"{database_name}_{timestamp.strftime('%Y%m%dT%H%M%S%fZ')}.json"
    path = os.path.join(SNAPSHOT_DIR, filename)
    with open(path, "w", encoding="utf-8") as snapshot_file:
        json.dump(schema, snapshot_file, indent=2)
    return {"snapshot_path": path, "timestamp": timestamp.isoformat().replace("+00:00", "Z")}


def save_snapshot(db_path: str) -> dict:
    """Save the current schema snapshot and return its metadata."""
    return _write_snapshot(db_path, _snapshot_schema(db_path))


def register_baseline(db_path: str) -> dict:
    """Register the current schema as the baseline for drift monitoring."""
    return _write_snapshot(db_path, _snapshot_schema(db_path), baseline=True)


def load_snapshot(path: str):
    with open(path, "r", encoding="utf-8") as snapshot_file:
        return json.load(snapshot_file)


def check_drift(db_path: str) -> dict:
    """Compare the live schema against the baseline for this database."""
    database_name = (
        "pasted-sql"
        if db_path.startswith("file:schemasphere-import-")
        else os.path.basename(db_path.split("?", 1)[0])
    )
    baseline_path = os.path.join(
        SNAPSHOT_DIR, f"{database_name}_baseline.json"
    )
    if not os.path.isfile(baseline_path):
        return {"error": "No baseline registered"}

    baseline = load_snapshot(baseline_path)
    live = _snapshot_schema(db_path)
    base_by_name = {table["name"]: table for table in baseline}
    live_by_name = {table["name"]: table for table in live}
    base_names = set(base_by_name)
    live_names = set(live_by_name)

    column_changes = []
    for table_name in sorted(base_names & live_names):
        base_columns = {column["name"] for column in base_by_name[table_name]["columns"]}
        live_columns = {column["name"] for column in live_by_name[table_name]["columns"]}
        added_columns = sorted(live_columns - base_columns)
        removed_columns = sorted(base_columns - live_columns)
        if added_columns or removed_columns:
            column_changes.append({
                "table": table_name,
                "added_columns": added_columns,
                "removed_columns": removed_columns,
            })

    return {
        "added_tables": sorted(live_names - base_names),
        "removed_tables": sorted(base_names - live_names),
        "column_changes": column_changes,
    }
