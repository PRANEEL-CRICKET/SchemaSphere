def generate_markdown(schema):
    """Generate simple markdown documentation from schema list.
    Returns a string.
    """
    lines = ["# Database Documentation", ""]
    for table in schema:
        lines.append(f"## Table `{table['name']}`")
        lines.append("\n| Column | Type | Not Null | Primary Key | Default |\n|--------|------|----------|-------------|---------|")
        for col in table['columns']:
            lines.append(f"| {col['name']} | {col['type']} | {'✔' if col['notnull'] else ''} | {'✔' if col['pk'] else ''} | {col['default'] or ''} |")
        lines.append("\n### Foreign Keys")
        if table['foreign_keys']:
            lines.append("\n| Column | References |\n|--------|------------|")
            for fk in table['foreign_keys']:
                lines.append(f"| {fk['from']} | `{fk['to_table']}`(`{fk['to_column']}`) |")
        else:
            lines.append("_None_")
        lines.append("\n### Indexes")
        if table.get('indexes'):
            lines.append("\n| Name | Columns | Unique | Partial |\n|------|---------|--------|---------|")
            for index in table['indexes']:
                columns = ", ".join(index.get('columns', []))
                lines.append(
                    f"| `{index['name']}` | {columns} | "
                    f"{'Yes' if index.get('unique') else 'No'} | "
                    f"{'Yes' if index.get('partial') else 'No'} |"
                )
        else:
            lines.append("_None_")
        lines.append("\n---\n")
    return "\n".join(lines)
