---
name: add-event
description: Add a disaster event card from Montandon.
when_to_use: The person asks to add, find or show a disaster event (a flood, an earthquake, a cyclone) on the board.
requires: events.search, event.add
---
To add a disaster event, find it with events__search first, then call event__add with its id. Never make up an event id.

Search at most 3 times. A year or a place in a request can be wrong. If no result matches, add nothing: reply with the closest events you found (name, date, country) and ask which one the person means, or ask for more details.
