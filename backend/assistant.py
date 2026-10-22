from .schema import get_schema
from typing import List, Dict, Any
import re

def _tables_without_pk(schema: List[Dict[str, Any]]) -> List[str]:
    return [t['name'] for t in schema if not any(col.get('pk') for col in t['columns'])]

def _tables_orphaned(schema: List[Dict[str, Any]]) -> List[str]:
    # No incoming or outgoing foreign keys
    all_tables = {t['name'] for t in schema}
    has_fk = set()
    for t in schema:
        for fk in t['foreign_keys']:
            has_fk.add(t['name'])
            has_fk.add(fk['to_table'])
    return list(all_tables - has_fk)

def _missing_fk_indexes(schema: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    # Placeholder: assume any FK column without an index is missing. Real implementation would inspect indexes.
    # Here we just return the FK info.
    missing = []
    for t in schema:
        for fk in t['foreign_keys']:
            missing.append({"table": t['name'], "column": fk['from']})
    return missing

def answer_question(question: str, db_path: str = 'sample.db') -> Dict[str, Any]:
    """Very simple natural‑language assistant.
    Returns a JSON‑serialisable dict with `answer` (string) and optional `data`.
    """
    schema = get_schema(db_path)
    q = question.lower()
    if re.search(r"no (primary|pk) key", q) or re.search(r"tables without primary", q):
        tables = _tables_without_pk(schema)
        return {"answer": f"Tables without a primary key: {', '.join(tables) or 'none'}", "data": tables}
    if re.search(r"orphan", q) or re.search(r"no relationships", q):
        tables = _tables_orphaned(schema)
        return {"answer": f"Orphaned tables (no FK relationships): {', '.join(tables) or 'none'}", "data": tables}
    if re.search(r"missing index", q) or re.search(r"fk index", q):
        missing = _missing_fk_indexes(schema)
        txt = ', '.join([f"{m['table']}.{m['column']}" for m in missing]) or 'none'
        return {"answer": f"Potential missing indexes on foreign‑key columns: {txt}", "data": missing}
    # fallback
    return {"answer": "I’m sorry, I don’t understand the request. Try asking about tables without primary keys, orphan tables, or missing foreign‑key indexes.", "data": None}
