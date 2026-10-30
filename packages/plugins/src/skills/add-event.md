---
name: add-event
description: Add a disaster event card from Montandon.
when_to_use: The person asks to add, find or show a disaster event (a flood, an earthquake, a cyclone) on the board.
requires: events.search, event.add
---
To add a disaster event, find it with events__search first, then call event__add with its id. Never make up an event id.
