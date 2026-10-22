import re
from typing import List, Dict, Any

import re
from typing import List, Dict, Any

def tables_without_primary_key(schema: List[Dict[str, Any]]) -> List[str]:
    """Return a list of table names that have no column marked as primary key."""
    return [t['name'] for t in schema if not any(col.get('pk') for col in t['columns'])]

def missing_foreign_key_indexes(schema: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Return foreign-key columns that are not covered by a leading index column."""
    missing = []
    for t in schema:
        for fk in t['foreign_keys']:
            column = fk['from']
            indexed = any(
                index.get('columns') and index['columns'][0] == column
                for index in t.get('indexes', [])
            )
            if not indexed:
                missing.append({"table": t['name'], "column": column})
    return missing

def redundant_indexes(indexes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Detect indexes that are subsets of other indexes.
    Placeholder implementation – returns empty list.
    """
    return []

def nullable_columns_without_need(schema: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Identify nullable columns that are primary keys or have NOT NULL constraints elsewhere.
    Placeholder – returns empty list.
    """
    return []

def naming_convention_issues(schema: List[Dict[str, Any]]) -> List[str]:
    """Check for tables/columns that do not follow snake_case naming.
    Returns list of offending identifiers.
    """
    pattern = re.compile(r'^[a-z][a-z0-9_]*$')
    issues = []
    for t in schema:
        if not pattern.match(t['name']):
            issues.append(t['name'])
        for col in t['columns']:
            if not pattern.match(col['name']):
                issues.append(f"{t['name']}.{col['name']}")
    return issues

def orphaned_tables(schema: List[Dict[str, Any]]) -> List[str]:
    """Tables with no incoming or outgoing foreign keys."""
    all_tables = {t['name'] for t in schema}
    related = set()
    for t in schema:
        for fk in t['foreign_keys']:
            related.add(t['name'])
            related.add(fk['to_table'])
    return list(all_tables - related)

def detect_cycles(schema: List[Dict[str, Any]]) -> List[List[str]]:
    """Detect simple cycles in foreign key graph.
    Returns list of cycles, each as list of table names.
    """
    graph = {t['name']: [fk['to_table'] for fk in t['foreign_keys']] for t in schema}
    visited = set()
    stack = []
    cycles = []
    def dfs(node, path):
        visited.add(node)
        path.append(node)
        for nxt in graph.get(node, []):
            if nxt in path:
                idx = path.index(nxt)
                cycles.append(path[idx:] + [nxt])
            elif nxt not in visited:
                dfs(nxt, path)
        path.pop()
    for n in graph:
        if n not in visited:
            dfs(n, [])
    return cycles

def quality_score(schema: List[Dict[str, Any]]) -> float:
    """Simple heuristic quality score (0-1). Lower score = more issues.
    For demo purposes we count missing PKs and naming issues.
    """
    total_tables = len(schema)
    if total_tables == 0:
        return 1.0
    pk_issues = len(tables_without_primary_key(schema))
    naming_issues = len(naming_convention_issues(schema))
    score = 1.0 - (pk_issues + naming_issues) / (2 * total_tables)
    return max(0.0, min(1.0, score))

def missing_foreign_key_indexes(schema: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Return foreign-key columns that are not covered by a leading index column."""
    missing = []
    for t in schema:
        for fk in t['foreign_keys']:
            column = fk['from']
            indexed = any(
                index.get('columns') and index['columns'][0] == column
                for index in t.get('indexes', [])
            )
            if not indexed:
                missing.append({"table": t['name'], "column": column})
    return missing

def redundant_indexes(indexes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Detect indexes that are subsets of other indexes.
    Placeholder implementation – returns empty list.
    """
    return []

def nullable_columns_without_need(schema: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Identify nullable columns that are primary keys or have NOT NULL constraints elsewhere.
    Placeholder – returns empty list.
    """
    return []

def naming_convention_issues(schema: List[Dict[str, Any]]) -> List[str]:
    """Check for tables/columns that do not follow snake_case naming.
    Returns list of offending identifiers.
    """
    pattern = re.compile(r'^[a-z][a-z0-9_]*$')
    issues = []
    for t in schema:
        if not pattern.match(t['name']):
            issues.append(t['name'])
        for col in t['columns']:
            if not pattern.match(col['name']):
                issues.append(f"{t['name']}.{col['name']}")
    return issues

def quality_score(schema: List[Dict[str, Any]]) -> float:
    """Simple heuristic quality score (0-1). Lower score = more issues.
    For demo purposes we count missing PKs and naming issues.
    """
    total_tables = len(schema)
    if total_tables == 0:
        return 1.0
    pk_issues = len(tables_without_primary_key(schema))
    naming_issues = len(naming_convention_issues(schema))
    score = 1.0 - (pk_issues + naming_issues) / (2 * total_tables)
    return max(0.0, min(1.0, score))
