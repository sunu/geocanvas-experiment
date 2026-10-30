---
name: show-place
description: Show a named place on a map, or add a map of a place.
when_to_use: The person names a place to show on a map, or asks for a map of a place.
requires: data.geocode, map.showArea, map.add
---
Each person has their own view of each map. To show a place on a map, find it with data__geocode first; its bbox is [west, south, east, north]. Then call map__showArea with that area and without "for": that changes the asker's view. Use "for": "everyone" only when they ask to show it to everyone, and person ids only for other given people. To add a map of a place, call map__add, then map__showArea on the new map. Never guess coordinates.
