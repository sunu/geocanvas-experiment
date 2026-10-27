# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repository. Humans are welcome to read it too.

## Project overview

**humanitarian-ttx** is a Humanitarian Table Top Exercise (TTX) for data exploration and response, built by Development Seed. The project is based on IFRC's Montandon project for data https://montandondata.org/. It's multiplayer canvas where users work on different aspects to developing a situation report after an event. It inludes finding related past events, current datasets, map visualizations, analysis ingests, etc.

At a high-level:
1. Users can start a new board and select an event from Montandon. This will do initial board setup. Showing the event data, map, and related events in that geography.
2. There are widgets for data selectors, map, charts, sticky notes. This is currently built on top of tldraw.
3. There are agents running entirely in the browser to do specific actions. Create new components, run analysis etc.
4. Data comes from Montandon via Duckdb. Additional data like OSM, Overture (buildings/infra) comes as geoparquet too.
5. There's a way to ingest analysis run from Jupyternotebooks from a different project called Notebook Factory
6. There are programmable actions and flow control in the advanced mode
7. It is possible to create reports and export them

We will build an abstraction for creating custom tldraw plugins so tldraw can be swapped out later.


## Repository layout

<!-- TODO
-->

## Setup and commands

<!-- TODO
-->

## Conventions

- Keep changes small and focused; ideally one change per PR.
- Match the style of surrounding code. Don't introduce new frameworks or dependencies without a ticket or ADR.
- Update this file when you add tooling, commands, or conventions agents need to know about.

## Git and PRs

- Branch from `main`; open a PR for review rather than pushing directly.
- Write clear commit messages describing *why*, not just *what*.
- Ensure tests and linters pass before requesting review.

## Ask before

Agents should check with a human before:

- Adding or upgrading dependencies
- Changing scenario content or exercise logic in ways facilitators rely on
- Deleting files, rewriting history, or force-pushing
- Anything that publishes or sends data outside the repo
