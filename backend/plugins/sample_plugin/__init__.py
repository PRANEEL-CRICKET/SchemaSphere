def init_plugin(app):
    @app.route('/api/sample')
    def sample_endpoint():
        return {'message': 'Sample plugin is active'}
