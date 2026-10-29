This is an infinite canvas app based on VSticky. We are making a new app on top of it, The new app should help policy makeres, disaster analysts to do their table top activites through this app. 

The features we are adding are below.

- New type of widgets
  - Table
  - Map
  - Chart
  - Jupyter Notebook 
  - (Stretch goal) Input - this will be either date, or location which can work as an input for Map or to fetch the data for Chart components
- Connection to the external database
  - For now, we are scoping the main database down to : https://montandon-eoapi-stage.ifrc.org/stac
  - There will be additional data source for analysis (ex. population, building data)
- Prepopulate the widdgets depending on the template that users choose
- Ability for agents to add/remove/edit widgets
- Approved openEO map layers: the agent can propose a Sentinel-1 before/after change recipe, or any openEO process graph (Sentinel-1, -2, -3), after checking that EOPF has scenes for the area and dates; a user explicitly approves before the Worker creates an EOPF XYZ service and renders a test tile.
- Ability for agent to sum up the current board and provide the report

Related to LLM: reference agents.md from experiments branch, but reference only llm related part, not the application related part.

Common features for all the widgets are like below

- The widgets will have dark mode, following the users' system settings (or app level setting that can be toggled with UI)
- All the widgets can be added/removed/edtied by agents
- All the widgets also can be added/removed/edited manually
- The new widgets will have full screen view that can be turned on by toggle
- The new widgets will have in-focus mode, and in-focus mode will show Options panel for Contextual tools 
  - in-focus mode will be enabled by a button click, and in-focus mode will zoom the widgets in and make it full-screen in the app.
  - changes in in-focus mode is not shared to other people unless you quit the focus mode of the app 


The specific features for each widgets is 

### Table
- It takes various tabular data format (csv, parquet, xlsx) and construct the compact table 
- When manually added
  - Data source selection (can be uploaded, can be called from url, or can be an automatically read from stac backend)

### Map
- The component already exists, edit as needed.
- It takes various geospatial data format (geojson, shp, geoparquet, COG, map tiles) and visualize it on top of the basemap.
- It shows the snapshot of the current map when zoomed out, but gives you interactive map when fully zoomed in.
- Shows the legend of the data
- When manually added, users need to do Location selection : Draw aoi on minimap, or enter lat lon, or enter bbox, or describe text if llm is connected
- It has Options panel, which gets displayed when a map is selected (Contextual tool)
  - Select the datasets
  - Annotate - draw, add marker, polygon/circle
  - Attribute panel to select/reselect data
  - Data filters
  - Legend formatting
  - The openEO layers come from EOPF's staging collections, which are sparse: Sentinel-1 covers mostly western Europe up to about mid-July 2026, Sentinel-2 is broad (Rome works for both; Nepal has no Sentinel-1). Use the agent's coverage check, or Rome with the dates in the PR. The output is a candidate layer, not a validated flood boundary. Local secrets: plain values in ignored `apps/worker/.dev.vars`, or 1Password references in ignored `apps/worker/.dev.vars.tpl` (`KEY={{ op://vault/item/field }}`), which `npm run sync` resolves with `op inject`. Wrangler passes `.dev.vars` entries on only if they are in `secrets.required` or `vars`: `OPENEO_USER` and `OPENEO_PASS` are empty `vars` placeholders so they work locally without being required when deploying.

### Chart
- It takes various types of data, and renders the data in chart type
- Type selection: Bar chart, bar segment, donut, line, stat, ranked list
- It has Options panel, which gets displayed when a chart is selected. From option, it can do  (Contextual tool)
  - - Data source selection (can be uploaded, can be called from url, or can be an automatically read from stac backend)
  - Attribute panel to select data
  - Data filters
  - Annotate, put markers on top.
  - Provenance
  - Change type

### Jupyter Notebook
- It takes notebook, and renders the notebook including output cells.
- It does not excute the code.

Non functional requirements are like below
- FPS on canvas should not drop below 30.
- We are not considering small screen view for now.
