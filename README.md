# SchemaSphere

A visual explorer for SQLite databases. Paste a SQLite script (or point at a `.db` file) and instantly explore the schema, relationships, analysis, documentation, and diagrams.

## Features

- Paste SQLite SQL in the dashboard and analyze it across every section (Schema Explorer, Analysis, Compare, Documentation, Profiling, Diagrams).
- Temporary isolated in-memory database — never touches your configured database.
- Schema health checks, missing FK indexes, naming issues, quality score.
- Migration diff between baseline and target databases.
- Performance index suggestions and table profiling.
- Auto-generated markdown documentation.
- ER-diagram generation.

## Project structure

```
backend/        Flask API + analysis modules
static/         Frontend (HTML/CSS/JS)
api/index.py    Vercel serverless entrypoint
vercel.json     Vercel routing config
```

## Run locally

```bash
pip install -r requirements.txt
python -m backend.app
```

Open http://127.0.0.1:5000.

Environment variables:

- `DB_PATH` — path to a SQLite database to use instead of the built-in sample.

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import the repo in Vercel.
3. Vercel detects `vercel.json` and builds `api/index.py` with `@vercel/python`.
4. Static assets under `/static` are served directly.

## Deploy on Streamlit

Deploy on Streamlit Cloud by pointing it at `streamlit_app.py`:

- https://share.streamlit.io/deploy


- `GET /api/schema` — current schema.
- `POST /api/sql/import` — import a SQLite script (`{ "sql": "..." }`).
- `GET /api/sql/source` — active database source info.
- `POST /api/sql/reset` — restore configured database.
- `GET /api/analysis` — health analysis.
- `GET /api/migrate/diff?base=&target=` — schema diff.
- `GET /api/performance` — index suggestions.
- `GET /api/profile?table=` — table profiling.
- `GET /api/doc` — markdown documentation.

## License

MIT
