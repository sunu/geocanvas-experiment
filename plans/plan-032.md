# Plan 032: IFRC GO emergencies and HDX datasets on the board

Status: IFRC GO card and HDX card built. Showing an HDX file on a map is not (it needs a proxy, below).

Builds on plan-031 (a card from a pasted link; the board stores the link, each browser reads the item). Both
sources were checked on 2026-10-30 with real requests, not from documentation.

## IFRC GO: built

**Feasible, and cheap.** `goadmin.ifrc.org/api/v2` answers anonymous GETs with `access-control-allow-origin: *`
and a preflight that allows GET, so a browser reads it directly: no Worker route, no key. No rate limit is stated
and none showed in the headers; a card costs 2 requests.

- **Links.** `https://go.ifrc.org/emergencies/<id>` (the web app's routes also have `/overview`, `/details`,
  `/reports`…, read as the emergency). Not read: `emergencies/slug/<slug>` (needs a lookup), `emergencies/all`,
  countries, appeals (an appeal has no page of its own, only `appeals/all`), field reports.
- **One emergency.** `GET /api/v2/event/<id>/` has everything the card shows: severity, `key_figures`,
  `appeals` (type, code, status, `amount_requested`, `amount_funded`, `num_beneficiaries`, in Swiss francs) and
  `field_reports`. Its `dtype` is a bare id, while the list endpoint (`/event/?id=<id>`) has the hazard's name but
  no key figures, so the hazard's name is a second request (`/disaster_type/<id>/`, kept per page for all cards).
  A missing or non-public emergency answers 404.
- **Contacts are in the answer** (names, job titles, emails of IFRC staff). The card never copies them, and a test
  checks that.
- **Not tied to Montandon.** Montandon's IFRC events and GO's emergencies are different ids; linking one to the
  other is not built.
- **Shared with the GitHub card** (`apps/web/src/cards/`, extracted when this second card made them the same
  concept): the link field, `useCardItem` (load, refresh, loading state) and `perPage` (the cache). What each
  source shows is its own, so there is no common card model yet.

## HDX: built (a preview of a dataset's metadata)

A dataset page is `https://data.humdata.org/dataset/<name>` (and `…/resource/<id>`); the CKAN API gives it as JSON.
The card is the same shape as the other two: `hdx` type, `hdx.setUrl`, `apps/web/src/hdx/`.

- **Reads work from a browser.** `GET /api/3/action/package_show?id=<name>` is anonymous for public datasets and
  sends `access-control-allow-origin: *` (also on the error answer and on a preflight, which allows GET and the
  `Content-Type` header). One request per card. No rate limit is stated and none showed in the headers; HDX HAPI's
  60 a minute, which the Worker already handles, is a different service.
- **What the card shows**: title, publisher, countries, the period the data covers (`dataset_date` is always
  `[start TO end]`; the card shows the two dates), the update frequency (`data_update_frequency`, in days as text,
  named as HDX names it: -1 Never, -2 As needed, 0 Live, 1 Every day, 7 Every week… 365 Every year; 71 of the 100
  flood datasets checked are -1), the last change, license, the first words of the description (`notes`, Markdown),
  caveats, source, and the first five files with format and size (HDX file names often end with the format: it is
  not repeated). Useful for a situation report: who published it, how fresh it is, its license.
- **Files on request.** A dataset with `is_requestdata_type` has an empty `resources` list (checked on
  `afghanistan-schools`); the card says the files are asked for through HDX. An `archived` dataset says so.
- **Links to files are built, not copied.** A file links to `…/dataset/<name>/resource/<id>` on HDX, made from the
  dataset's link and the file's id (only when the id is a UUID), never from the `url` or `download_url` in the
  answer.
- **Not found and private.** A missing dataset answers 404 with a JSON body (CORS still open); a private one is
  expected to answer 403 (not tried): the card says it may be private.
- **Names.** HDX names are lowercase (`COD-AB-NPL` answers 404), so an uppercase link is not read. A name can change
  on HDX; the card stores the name from the link.

### Files are not readable from a browser

A resource's download link redirects (302) to a signed Amazon S3 address, and the first answer allows only
`https://data.humdata.org` as origin, so a browser on another origin cannot follow it. A "show this file on a map"
button therefore needs a Worker proxy, with its size limit, allow-list of hosts and abuse risk (anyone with a board
link could use it): a separate decision. The card links to the files without it. HDX HAPI's metadata
(`metadata/resource`, shown by the country widgets) already names datasets, so those can be put on the board by
pasting their links.

### Not built

HDX's own data previews (some resources have `dataset_preview_enabled`; how they are served was not looked at); a
file's page as its own card; private datasets; a dataset's other pages (organization, group, search).
