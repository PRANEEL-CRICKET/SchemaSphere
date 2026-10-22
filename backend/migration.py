def generate_schema_diff(base_db_path: str, target_db_path: str) -> dict:
    """Very simple schema diff generator.
    For demo purposes we reuse the existing get_schema function for both databases
    and compute added/removed tables and columns.
    """
    from .db_adapter import get_adapter
    base_adapter = get_adapter('sqlite', base_db_path)
    try:
        target_adapter = get_adapter('sqlite', target_db_path)
        try:
            base_schema = []
            for tbl in base_adapter.get_tables():
                base_schema.append({
                    'name': tbl,
                    'columns': base_adapter.get_columns(tbl),
                    'foreign_keys': base_adapter.get_foreign_keys(tbl),
                })
            target_schema = []
            for tbl in target_adapter.get_tables():
                target_schema.append({
                    'name': tbl,
                    'columns': target_adapter.get_columns(tbl),
                    'foreign_keys': target_adapter.get_foreign_keys(tbl),
                })
        finally:
            target_adapter.close()
    finally:
        base_adapter.close()

    base_tables = {t['name'] for t in base_schema}
    target_tables = {t['name'] for t in target_schema}

    added_tables = sorted(target_tables - base_tables)
    removed_tables = sorted(base_tables - target_tables)

    # Column-level changes for tables present in both.
    common = sorted(base_tables & target_tables)
    column_changes = []
    for tbl in common:
        base_columns = {
            column['name']: column
            for column in next(t for t in base_schema if t['name'] == tbl)['columns']
        }
        target_columns = {
            column['name']: column
            for column in next(t for t in target_schema if t['name'] == tbl)['columns']
        }
        added = [name for name in target_columns if name not in base_columns]
        removed = [name for name in base_columns if name not in target_columns]
        modified = []
        for name in base_columns:
            if name not in target_columns:
                continue
            before = base_columns[name]
            after = target_columns[name]
            changed_fields = [
                field for field in ('type', 'notnull', 'default', 'pk')
                if before.get(field) != after.get(field)
            ]
            if changed_fields:
                modified.append({
                    'name': name,
                    'before': before,
                    'after': after,
                    'changed_fields': changed_fields,
                })
        if added or removed or modified:
            column_changes.append({
                'table': tbl,
                'added_columns': added,
                'removed_columns': removed,
                'modified_columns': modified,
                'added_column_definitions': [target_columns[name] for name in added],
                'removed_column_definitions': [base_columns[name] for name in removed],
            })

    return {
        'added_tables': added_tables,
        'removed_tables': removed_tables,
        'column_changes': column_changes,
        'added_table_definitions': [
            table for table in target_schema if table['name'] in target_tables - base_tables
        ],
    }
