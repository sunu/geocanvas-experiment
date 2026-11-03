# Local JupyterHub for code cells

Code cells (`plans/plan-021.md`) run Python on your own JupyterHub. This folder has a configuration for a local
hub, for tests on your machine only. Do not use it on a server: any user name signs in with one shared password,
and all servers run as you.

## Requirements

- `uv` (for `uvx`)
- Node and `npx` (the hub's proxy is an npm package)

## Start the hub

From the repository root:

```sh
cd extras/jupyterhub
uvx --from jupyterhub --with jupyterlab --with geopandas --with shapely \
  --with pystac-client --with matplotlib jupyterhub -f jupyterhub_config.py
```

The first start downloads the packages. This can take a few minutes.

The hub writes its state (`jupyterhub.sqlite`, `jupyterhub_cookie_secret`) to this folder. Git ignores these files.

## Connect a board

1. Start the board: `npm run sync` and `npm run dev`.
2. Open http://127.0.0.1:8000 and sign in with any user name and the password `ttx`.
3. Open http://127.0.0.1:8000/hub/token and make a token.
4. On the board, click the terminal button in the user menu. Enter `http://127.0.0.1:8000` and the token.
5. Draw a code cell with **C** or the toolbar's **Code** button. Double-click the cell to write Python, then click
   Run.

## Board addresses

`BOARD_ORIGINS` in `jupyterhub_config.py` lists the board addresses that may run code: `localhost` ports 5173 to
5175 (Vite takes the next port when one is in use) and 8787 (`npm run sync`). `BOARD_ORIGIN_PATTERNS` adds the
deployed boards: main's Worker and every branch's (`https://humanitarian-ttx-<branch>.development-seed.workers.dev`).
A deployed (HTTPS) board can use this local hub: browsers let an HTTPS page call `127.0.0.1`. Chrome may first ask
you to allow the site to reach devices on your local network. If your board has another address,
for example `http://127.0.0.1:5173`, add it as the address bar shows it (scheme, host and port), then start the hub
again and stop your server at http://127.0.0.1:8000/hub/home, so that it starts with the new list. If the board's
address is not in the list, the user menu shows "Cannot reach the hub".

Jupyter Server checks each request's origin against this list. The hub's own API answers every origin (`*`): it
cannot answer per origin, and with a token in a header this is safe. A browser sends no cookies on a `*` answer.

## A hub on a server

A real hub needs the same CORS settings, with the deployed board's origin in `BOARD_ORIGINS` and as the hub's
`Access-Control-Allow-Origin` (not `*`). On an HTTPS hub, do not set
`JUPYTERHUB_ALLOW_TOKEN_IN_URL`. See "Hub setup" in `plans/plan-021.md`.
