def suggest_indexes(db_path: str):
    """Suggest indexes for foreign-key columns lacking a leading index."""
    from .schema import get_schema

    suggestions = []
    for table in get_schema(db_path):
        indexes = table.get("indexes", [])
        for foreign_key in table.get("foreign_keys", []):
            column = foreign_key["from"]
            if any(index.get("columns") and index["columns"][0] == column for index in indexes):
                continue
            safe_table = table["name"].replace('"', '""')
            safe_column = column.replace('"', '""')
            index_name = f"idx_{table['name']}_{column}".replace('"', '""')
            suggestions.append({
                "table": table["name"],
                "column": column,
                "suggested_index": (
                    f'CREATE INDEX "{index_name}" ON "{safe_table}" ("{safe_column}");'
                ),
            })
    return suggestions
