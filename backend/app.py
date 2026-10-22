from flask import Flask, jsonify, send_from_directory, Response, request
from werkzeug.exceptions import RequestEntityTooLarge
from .schema import get_schema
from .doc_generator import generate_markdown
import os
import sqlite3
import threading

app = Flask(__name__, static_folder=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "static")), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 1_000_000
_DATABASE_CONTEXT_LOCK = threading.RLock()

from .sample_data import (
    DEFAULT_DATABASE_PATH,
    DEMO_BASELINE_PATH,
    DEMO_TARGET_PATH,
    ensure_demo_migration_databases,
    ensure_sample_database,
)

if not os.getenv("DB_PATH"):
    ensure_sample_database()
ensure_demo_migration_databases()


def current_database_path():
    from .sql_import import get_active_database_uri

    return get_active_database_uri() or os.getenv("DB_PATH") or DEFAULT_DATABASE_PATH


@app.before_request
def lock_database_context():
    if request.path.startswith("/api/"):
        _DATABASE_CONTEXT_LOCK.acquire()
        request.environ["schemasphere_database_lock"] = True


@app.teardown_request
def unlock_database_context(error):
    if request.environ.pop("schemasphere_database_lock", False):
        _DATABASE_CONTEXT_LOCK.release()


@app.errorhandler(FileNotFoundError)
def database_file_not_found(error):
    if request.path.startswith("/api/"):
        return jsonify({"error": str(error)}), 404
    return str(error), 404


@app.errorhandler(sqlite3.DatabaseError)
def database_error(error):
    if request.path.startswith("/api/"):
        return jsonify({"error": str(error)}), 500
    return str(error), 500


@app.errorhandler(RequestEntityTooLarge)
def request_too_large(error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Request body exceeds the 1 MB limit."}), 413
    return "Request body exceeds the 1 MB limit.", 413


# Initialise plugin system
from .plugin_manager import PluginManager
PluginManager(app)

@app.route('/api/schema')
def api_schema():
    db_path = current_database_path()
    schema = get_schema(db_path)
    return jsonify(schema)


@app.route('/api/sql/import', methods=['POST'])
def api_import_sql():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("sql"), str):
        return jsonify({"error": "Provide a JSON body with a string 'sql' field."}), 400
    from .sql_import import import_sqlite_script
    try:
        result = import_sqlite_script(data["sql"])
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    return jsonify(result)


@app.route('/api/sql/source')
def api_sql_source():
    from .sql_import import get_active_database_info
    return jsonify(get_active_database_info())


@app.route('/api/sql/reset', methods=['POST'])
def api_reset_sql():
    from .sql_import import reset_sqlite_import
    return jsonify(reset_sqlite_import())


@app.route('/api/doc')
def api_doc():
    db_path = current_database_path()
    schema = get_schema(db_path)
    md = generate_markdown(schema)
    return Response(md, mimetype='text/markdown')

# Serve the front‑end HTML
@app.route('/')
def index():
    return send_from_directory(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "static")), "index.html")

# Register blueprints and additional routes
from .connection_manager import bp as connections_bp
app.register_blueprint(connections_bp)

@app.route('/api/analysis')
def api_analysis():
    db_path = current_database_path()
    schema = get_schema(db_path)
    # Import analysis functions lazily
    from .analysis import (
        tables_without_primary_key,
        missing_foreign_key_indexes,
        naming_convention_issues,
        quality_score,
    )
    result = {
        'tables_without_pk': tables_without_primary_key(schema),
        'missing_fk_indexes': missing_foreign_key_indexes(schema),
        'naming_issues': naming_convention_issues(schema),
        'quality_score': quality_score(schema),
    }
    return jsonify(result)

@app.route('/api/migrate/diff')
def api_migration_diff():
    # Expected query params: base (path to baseline db) and target (path to target db)
    base = request.args.get('base')
    target = request.args.get('target')
    if not base or not target:
        return jsonify({'error': 'Missing base or target parameters'}), 400
    current_db = current_database_path()
    if base == '__current__':
        base = current_db
    if target == '__current__':
        target = current_db
    if base == '__demo_baseline__':
        base = DEMO_BASELINE_PATH
    if target == '__demo_target__':
        target = DEMO_TARGET_PATH
    from .migration import generate_schema_diff
    diff = generate_schema_diff(base, target)
    return jsonify(diff)

@app.route('/api/performance')
def api_performance():
    db_path = current_database_path()
    from .performance import suggest_indexes
    suggestions = suggest_indexes(db_path)
    return jsonify(suggestions)

@app.route('/api/profile')
def api_profile():
    db_path = current_database_path()
    from .profiling import profile_table
    table = request.args.get('table')
    if not table:
        return jsonify({'error': 'Missing table parameter'}), 400
    try:
        profile = profile_table(db_path, table)
    except LookupError as error:
        return jsonify({'error': str(error)}), 404
    return jsonify(profile)

@app.route('/api/version/snapshot')
def api_snapshot():
    db_path = current_database_path()
    from .versioning import save_snapshot
    snap = save_snapshot(db_path)
    return jsonify(snap)

@app.route('/api/drift/register')
def api_register_baseline():
    db_path = current_database_path()
    from .versioning import register_baseline
    baseline = register_baseline(db_path)
    return jsonify(baseline)

@app.route('/api/drift/check')
def api_drift_check():
    db_path = current_database_path()
    from .versioning import check_drift
    drift = check_drift(db_path)
    return jsonify(drift)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)
