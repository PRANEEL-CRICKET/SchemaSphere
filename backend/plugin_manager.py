import importlib
import os
from typing import Dict, List

PLUGIN_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), 'plugins'))

class PluginManager:
    def __init__(self, app):
        self.app = app
        self.plugins: Dict[str, Dict] = {}
        self.load_plugins()
        self.register_api()

    def load_plugins(self):
        if not os.path.isdir(PLUGIN_DIR):
            return
        for entry in os.listdir(PLUGIN_DIR):
            plugin_path = os.path.join(PLUGIN_DIR, entry)
            if os.path.isdir(plugin_path) and os.path.isfile(os.path.join(plugin_path, '__init__.py')):
                try:
                    module_name = f'backend.plugins.{entry}'
                    module = importlib.import_module(module_name)
                    # each plugin should expose an ``init_plugin(app)`` function
                    if hasattr(module, 'init_plugin'):
                        module.init_plugin(self.app)
                        self.plugins[entry] = {'name': entry, 'enabled': True}
                except Exception as e:
                    # Log error but continue loading other plugins
                    print(f'Failed to load plugin {entry}: {e}')

    def register_api(self):
        @self.app.route('/api/plugins')
        def list_plugins():
            # Simple JSON list of plugin metadata
            return {name: meta for name, meta in self.plugins.items()}
