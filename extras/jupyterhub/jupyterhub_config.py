# A local JupyterHub to run code cells against (plans/plan-018.md). For tests on your own machine only:
# any user name signs in with the password below, and every user's server runs as you, with no isolation.
# How to start it: extras/jupyterhub/README.md.
import re
import sys

c = get_config()  # noqa: F821 - JupyterHub defines it

# The boards that may run code here: the dev servers (npm run dev; Vite takes the next port when one is in use) and
# the local Worker (npm run sync). Add a board's origin (scheme, host and port, as in its address bar) to use it.
BOARD_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:8787',
]

c.JupyterHub.bind_url = 'http://127.0.0.1:8000'

# Any user name, one shared password.
c.JupyterHub.authenticator_class = 'dummy'
c.DummyAuthenticator.password = 'ttx'
c.Authenticator.allow_all = True

# Each user's server is a local process of the same Python environment as the hub (the uvx one).
c.JupyterHub.spawner_class = 'simple'
c.Spawner.cmd = [sys.executable, '-m', 'jupyterhub.singleuser']

# The board calls the hub API and the user's server from the browser: both must allow its origin (CORS).
# A user's server checks each request's origin against this list and answers with the one that matches.
c.Spawner.args = ['--ServerApp.allow_origin_pat=^(' + '|'.join(re.escape(o) for o in BOARD_ORIGINS) + ')$']
# The hub sends fixed headers, so it cannot answer per origin: '*'. This is safe here because the board sends its
# token in a header, and browsers send no cookies on a '*' answer. A hub on a server names its one board origin.
c.JupyterHub.tornado_settings = {
    'headers': {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    }
}

# The kernel's WebSocket carries the token in its URL. JupyterHub 5 and later accept that only with the
# Sec-Fetch-Mode: websocket header, which browsers send only to HTTPS hosts. This hub is plain HTTP, so allow it.
# Do not set this on an HTTPS hub.
c.Spawner.environment = {'JUPYTERHUB_ALLOW_TOKEN_IN_URL': '1'}

# The hub's proxy, from npm.
c.ConfigurableHTTPProxy.command = ['npx', '-y', 'configurable-http-proxy']
