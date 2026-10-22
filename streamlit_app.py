import threading
import time

import streamlit as st
import streamlit.components.v1 as components

# Start the Flask app in a background thread.
def _run_flask():
    from backend.app import app
    app.run(host="127.0.0.1", port=5000, use_reloader=False)

threading.Thread(target=_run_flask, daemon=True).start()
time.sleep(2)

st.set_page_config(page_title="SchemaSphere", layout="wide")
st.title("SchemaSphere")
components.iframe("http://127.0.0.1:5000", height=900, scrolling=True)
