# The preamble each kernel runs once (plans/plan-018.md, apps/web/src/code/kernel.ts). It defines _ttx_run, which
# runs a cell's code in a fresh namespace, and `ttx.show`, which gives the output in one MIME type the board reads.
# The board's kinds: geo.features, image.png, table, text, number, json (packages/plugins/src/codeOutput.ts).


def _ttx_setup():
    import ast
    import base64
    import io
    import json
    import sys
    import traceback
    import types

    from IPython.display import display

    OUTPUT = 'application/vnd.ttx.output+json'
    ERROR = 'application/vnd.ttx.error+json'
    CELL = '<cell>'

    # A value can be a GeoDataFrame, a DataFrame or a Figure only if the code imported that library: look the
    # library up instead of importing it, which would cost seconds (matplotlib builds a font cache on first import).
    def loaded(name):
        return sys.modules.get(name)

    def _geo(obj):
        """GeoJSON (a FeatureCollection, in longitude/latitude) for a geometry, a GeoSeries or a GeoDataFrame."""
        gpd = loaded('geopandas')
        if gpd is not None and isinstance(obj, (gpd.GeoDataFrame, gpd.GeoSeries)):
            if obj.crs is not None and obj.crs.to_epsg() != 4326:
                obj = obj.to_crs(4326)
            if isinstance(obj, gpd.GeoSeries):
                obj = gpd.GeoDataFrame(geometry=obj)
            return json.loads(obj.to_json(default=str))
        shapely = loaded('shapely')
        if shapely is not None and isinstance(obj, shapely.geometry.base.BaseGeometry):
            return {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {}, 'geometry': shapely.geometry.mapping(obj)}]}
        return None

    def _is_geojson(obj):
        return isinstance(obj, dict) and obj.get('type') in (
            'FeatureCollection', 'Feature', 'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection')

    def _as_collection(obj):
        if obj['type'] == 'FeatureCollection':
            return obj
        feature = obj if obj['type'] == 'Feature' else {'type': 'Feature', 'properties': {}, 'geometry': obj}
        return {'type': 'FeatureCollection', 'features': [feature]}

    def _table(obj):
        pd = loaded('pandas')
        if pd is None:
            return None
        if isinstance(obj, pd.Series):
            obj = obj.to_frame()
        if not isinstance(obj, pd.DataFrame):
            return None
        frame = obj.reset_index() if not isinstance(obj.index, pd.RangeIndex) else obj
        return json.loads(frame.to_json(orient='split', index=False, default_handler=str))

    def _png(obj):
        figure = loaded('matplotlib.figure')
        if figure is None or not isinstance(obj, figure.Figure):
            return None
        buf = io.BytesIO()
        obj.savefig(buf, format='png', bbox_inches='tight', dpi=120)
        return base64.b64encode(buf.getvalue()).decode('ascii')

    def to_output(obj, kind=None):
        """The board's output for a Python value, as {kind, value}."""
        if kind in (None, 'geo.features'):
            geo = _geo(obj) or (_as_collection(obj) if _is_geojson(obj) else None)
            if geo is not None:
                return {'kind': 'geo.features', 'value': geo}
        if kind in (None, 'table'):
            t = _table(obj)
            if t is not None:
                return {'kind': 'table', 'value': {'columns': [str(c) for c in t['columns']], 'rows': t['data']}}
        if kind in (None, 'image.png'):
            png = _png(obj)
            if png is not None:
                return {'kind': 'image.png', 'value': png}
        if kind in (None, 'number') and isinstance(obj, (int, float)) and not isinstance(obj, bool):
            return {'kind': 'number', 'value': obj}
        np = loaded('numpy')
        if np is not None and kind in (None, 'number') and isinstance(obj, np.number):
            return {'kind': 'number', 'value': obj.item()}
        if kind in (None, 'text') and isinstance(obj, str):
            return {'kind': 'text', 'value': obj}
        if kind in (None, 'json'):
            try:
                return {'kind': 'json', 'value': json.loads(json.dumps(obj, default=str))}
            except (TypeError, ValueError):
                pass
        return {'kind': 'text', 'value': repr(obj)}

    state = {'shown': False}

    def show(obj, kind=None):
        """Give `obj` as the cell's output (the last call wins). kind forces one: 'geo.features', 'table', 'text'..."""
        state['shown'] = True
        display({OUTPUT: to_output(obj, kind)}, raw=True)

    ttx = types.SimpleNamespace(show=show, to_output=to_output)

    def run(encoded):
        """Run a cell's code (base64, UTF-8) in a fresh namespace. Its last expression is the output, unless it called ttx.show."""
        source = base64.b64decode(encoded).decode('utf-8')
        state['shown'] = False
        namespace = {'__name__': '__ttx__', 'ttx': ttx}
        try:
            tree = ast.parse(source, CELL)
            last = None
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last = ast.Expression(tree.body.pop().value)
            exec(compile(tree, CELL, 'exec'), namespace)
            value = eval(compile(last, CELL, 'eval'), namespace) if last is not None else None
            if value is not None and not state['shown']:
                show(value)
        except BaseException as error:  # noqa: B036 - KeyboardInterrupt is a timeout, which the board reports too
            frames = traceback.extract_tb(error.__traceback__)
            # From the cell's first frame on: our own frames say nothing to whoever wrote the code.
            first = next((i for i, f in enumerate(frames) if f.filename == CELL), len(frames))
            lines = traceback.format_list(frames[first:])
            if isinstance(error, SyntaxError):
                lines = traceback.format_exception_only(type(error), error)
            lines = [line.replace('File "<cell>"', 'Cell').rstrip() for line in lines]
            for i, frame in enumerate(frames[first:]):
                if frame.filename == CELL and frame.lineno:
                    code = source.splitlines()[frame.lineno - 1:frame.lineno]
                    if code and not lines[i].endswith(code[0].strip()):
                        lines[i] += '\n    ' + code[0].strip()
            display({ERROR: {'ename': type(error).__name__, 'evalue': str(error), 'traceback': lines}}, raw=True)

    return run


_ttx_run = _ttx_setup()
del _ttx_setup
