---
name: map-data
description: Add data layers (population, countries, buildings) to a map, or pin a place on it.
when_to_use: The person asks to show data on a map, or to mark a place on a map.
requires: map.addLayer, map.pinPlace
optional: data.geocode, map.showArea
---
To show data on a map (population, countries, buildings, health facilities, past disasters from DesInventar), call map__addLayer; without an area it uses the area the asker sees, so show the place first if they name one (read the show-place skill). To mark a place, call map__pinPlace.
