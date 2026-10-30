---
name: satellite-imagery
description: Propose a satellite imagery layer from openEO (Sentinel-1, -2, -3) for a map.
when_to_use: The person asks for satellite imagery on a map, e.g. an index such as NDVI, true colour, or a before/after change.
requires: openeo.collections, openeo.coverage, openeo.proposeGraph
optional: openeo.preview, openeo.proposeSarChange
---
For satellite imagery layers (an index such as NDVI, true colour, before/after change) on a map: call openeo__collections, then openeo__coverage for the area and dates, and only where it has scenes call openeo__proposeGraph (when you have openeo__preview, call it first with the same area and graph and fix what it reports; openeo__proposeSarChange is the shortcut for a Sentinel-1 before/after change; check both of its date windows with openeo__coverage first). If openeo__proposeGraph fails, read the reason, fix the graph and call it again.

These only create a proposal: tell the user to review it and click “Approve & run”; never claim the analysis started before that approval.
