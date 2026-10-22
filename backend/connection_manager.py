import sqlite3
from flask import Blueprint, jsonify, request

bp = Blueprint('connections', __name__, url_prefix='/api/connections')

# In-memory storage for demo purposes – in production you would persist securely.
_connections = {}

@bp.route('/', methods=['GET'])
def list_connections():
    return jsonify([
        {"name": connection["name"], "type": connection["type"]}
        for connection in _connections.values()
    ])

@bp.route('/', methods=['POST'])
def add_connection():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'A JSON request body is required'}), 400
    name = data.get('name')
    db_type = data.get('type', 'sqlite')
    conn_str = data.get('conn_str', '')
    if not isinstance(name, str) or not name.strip():
        return jsonify({'error': 'Name is required'}), 400
    if not isinstance(conn_str, str):
        return jsonify({'error': 'conn_str must be a string'}), 400
    if db_type not in ('sqlite', 'postgres', 'mysql'):
        return jsonify({'error': 'Unsupported database type'}), 400
    _connections[name.strip()] = {
        'name': name.strip(),
        'type': db_type,
        'conn_str': conn_str,
    }
    return jsonify({'name': name.strip(), 'type': db_type}), 201

@bp.route('/<name>', methods=['DELETE'])
def delete_connection(name):
    if name in _connections:
        del _connections[name]
        return '', 204
    return jsonify({'error': 'Not found'}), 404

@bp.route('/test', methods=['POST'])
def test_connection():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'status': 'error', 'message': 'A JSON request body is required'}), 400
    db_type = data.get('type', 'sqlite')
    conn_str = data.get('conn_str')
    if not isinstance(conn_str, str) or not conn_str:
        return jsonify({'status': 'error', 'message': 'conn_str is required'}), 400
    from .db_adapter import get_adapter
    adapter = None
    try:
        adapter = get_adapter(db_type, conn_str)
        tables = adapter.get_tables()
        return jsonify({'status': 'success', 'tables': tables})
    except (ValueError, OSError, sqlite3.Error, ImportError) as error:
        return jsonify({'status': 'error', 'message': str(error)}), 400
    finally:
        if adapter is not None:
            adapter.close()
