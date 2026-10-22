# SchemaSphere

A visual explorer for SQLite databases. Paste a SQLite script (or point at a `.db` file) and instantly explore the schema, relationships, analysis, documentation, and diagrams.

## Run locally

```bash
pip install -r requirements.txt
python -m backend.app
```

Open http://127.0.0.1:5000.

## Deploy on Vercel

This project is configured for Vercel via `vercel.json`. Push to GitHub and import the repo in Vercel; the Python serverless function in `api/index.py` serves the Flask app.
