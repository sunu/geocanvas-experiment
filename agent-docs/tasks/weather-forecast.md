# Task: forecast context on the map (issue #43)

Date: 2026-10-28. Status: implemented on `feat/weather-forecast`.

## Goal

Give exercise participants concise forecast context for a disaster event, complementing the existing event footprints and humanitarian data. Forecasts are context only, not impact estimates or official warnings.

## Scope change from the issue

The issue asked for a point forecast shown in the Chart widget, and listed a weather map layer as out of scope. The Chart widget does not exist yet, and a tabletop needs to see whether the rain or wind is over the affected area and where it is heading, which a single point cannot show. On 2026-10-28 the scope was changed to a **map layer** (rain and wind), with no hover value. A point forecast and time series wait for the Chart widget.

## Provider and terms (acceptance criterion 1)

Checked 2026-10-28. Sources: https://dynamical.org, https://dynamical.org/license/, https://stac.dynamical.org/noaa-gfs-forecast/collection.json.

- **What dynamical.org is.** A catalog of cloud-optimized forecast and analysis datasets (NOAA GFS, GEFS, HRRR, ECMWF IFS and AIFS, DWD ICON-EU, Google WeatherNext 2, and more), with a STAC catalog at `stac.dynamical.org`. It has **no point-forecast HTTP API**: every dataset is an **Icechunk v2 repository** on public S3 (`https://dynamical-noaa-gfs.s3.us-west-2.amazonaws.com/noaa-gfs-forecast/v0.2.7.icechunk`). A reader fetches only the chunks it needs by range request.
- **Beta status.** Not stated on the site or in the STAC metadata. The repository path carries a version (`v0.2.7`), so it can change: if a layer fails to open the repository, look for a newer version in the collection's `icechunk-https` asset.
- **License.** The GFS forecast collection is **CC-BY-4.0** (`license` field, link to the license text), which allows commercial use and redistribution with attribution. Each dataset states its own license and may add provider terms: check the collection before using another. The site's own text is CC BY-NC-SA 4.0, which does not cover the data.
- **Attribution.** Producer: NOAA NWS NCEP; processor and host: dynamical.org. The layer shows "NOAA NWS NCEP GFS via dynamical.org, CC BY 4.0" in the map's credits.
- **Limits.** No rate limit or key is documented for the S3 bucket; it is a public object store. Reads are small (a few chunks of a few hundred KB compressed, about 6 MB decoded), but not free: cold, a layer takes about 10 s.
- **CORS.** The bucket answers `Access-Control-Allow-Origin: *` to `GET` and `HEAD`, so browsers read it directly. Confirmed in a browser check (range reads through `icechunk-js`).
- **Warranty and use.** The data is a model forecast: it is shown as context, never as a warning or a prediction of impact.
- **Why not Open-Meteo.** A simple point API, but its free tier is for non-commercial use only, with 10,000 calls a day, and it does not return grids. Not chosen for a map layer.

The libraries: `icechunk-js` 0.6.1 (read-only Icechunk reader, MIT, community) and `zarrita` 0.7.5 (Zarr, MIT). They add about 1.7 MB (0.5 MB gzipped) to the Worker bundle, mostly Zarr codecs.

## What was built

See the "Weather forecast layers" entry in `AGENTS.md`. In short: the op `map.addForecast` (async `prepare`, run with `invoke`), the tool `weather.forecast` returning a `geo.grid`, and the Options panel's "Weather forecast" section; the layer list and the map's credits show the model, run, valid times and that it is not an official warning.

## Acceptance criteria

1. Provider, limits, license and attribution: this document.
2. A forecast for an area in view, with valid times, units (mm, m/s), model, run time and attribution: yes. For "an event location": the map is fitted to an event first (the map's Add layer menu already fits to an event's footprint); a forecast for the area in view follows.
3. The run is stored in the layer's recipe and named in its title, so everyone on the board sees the same forecast; the caption says it is not an official warning.
4. Handled with a message and nothing written: no run complete yet, a run removed from the repository, an area wider than 30°, the repository not opening, S3 errors.
5. `packages/plugins/test/weather.test.ts` and `apps/web/test/forecastGrid.test.ts` (parsing, aggregation, run lookup, failures, the op); the browser flow was run by hand against the real repository (rain and peak wind, the too-wide error).

## Out of scope / follow-up

- A point forecast and time series in the Chart widget.
- A hover value, other variables (temperature, pressure) and models (GEFS ensembles, ECMWF).
- Updating a layer to a newer run (remove and add again for now).
- A Worker-side cutout, if the Worker bundle size ever matters.
