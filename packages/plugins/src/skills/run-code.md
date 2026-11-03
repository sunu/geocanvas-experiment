---
name: run-code
description: Write Python, run it on the person's JupyterHub, and put the result on the board (geometry on a map, a table, a number, an image).
when_to_use: The request needs a computation no other tool does, such as a buffer or intersection of shapes, a STAC search, or numbers worked out from data.
requires: code.add, code.execute
optional: code.run, code.show, data.geocode
---
Use code only when no other tool does the job: to show a place use the show-place skill, for data layers the map-data skill.

1. Find the inputs you need first, e.g. a place's coordinates with data__geocode. Put them in the code as literals: the code cannot read the board.
2. Write short, self-contained Python. Each run starts with no variables from earlier runs. Import what you use. geopandas, shapely, pandas, numpy, matplotlib and pystac-client are usually installed.
3. The output is the value of the last line, or what you pass to ttx.show(value). Kinds:
   - features: a shapely geometry, a GeoSeries or GeoDataFrame (any CRS; it is converted to longitude/latitude), or a GeoJSON dict. A map shows these as a layer, an input as its area.
   - table: a pandas DataFrame or Series.
   - number, text, JSON: a number, a string, a dict or list. A text or sticky note shows a number or text.
   - image: a matplotlib Figure.
4. Distances in metres need a projected CRS: buffer in UTM, never in degrees. Example, 10 km around a point:
   import geopandas as gpd
   from shapely.geometry import Point
   p = gpd.GeoSeries([Point(85.324, 27.7172)], crs=4326)
   p.to_crs(p.estimate_utm_crs()).buffer(10_000).to_crs(4326)
5. For a STAC search use pystac_client.Client.open(url).search(bbox=..., datetime=..., max_items=50), and give a GeoDataFrame of the item footprints (gpd.GeoDataFrame.from_features(items.item_collection().to_dict(), crs=4326)) or a table of ids, dates and properties.
6. Test with code__execute: it gives the output or the error, and changes nothing. Fix the code until it works.
7. Then call code__add with a title that says what it makes, the source, and showOn: the id of the map (or input, image, text, sticky) that should show it. Leave out showOn for a table or other output that only the cell shows. To change a cell's code, call code__run with the new source on that cell; to show its output somewhere else, code__show.
8. A run stops after 60 seconds. Keep searches small (a small area, a few dates, max_items).
