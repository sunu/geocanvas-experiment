# Plan 031: IFRC GO emergencies on the board, and what HDX links would take

Status: IFRC GO card built. HDX card not built (feasibility below).

Builds on plan-030 (a card from a pasted link; the board stores the link, each browser reads the item). Both
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

## HDX: feasible, not built

A dataset page is `https://data.humdata.org/dataset/<name>` (and `…/resource/<id>`); the CKAN API gives it as
JSON.

- **Reads work from a browser.** `GET /api/3/action/package_show?id=<name>` is anonymous for public datasets and
  sends `access-control-allow-origin: *` (also on the error answer and on a preflight, which allows GET and the
  `Content-Type` header). One request per card. No rate limit is stated and none showed in the headers; HDX HAPI's
  60 a minute, which the Worker already handles, is a different service.
- **What a card could show** (from a real dataset, `cod-ab-npl`): `title`, `organization.title`, `notes`
  (Markdown), `dataset_date` (the period the data covers, as `[start TO end]`), `data_update_frequency` (days),
  `last_modified`, `license_title`, `caveats`, `methodology`, `dataset_source`, the countries (`groups`), and
  `resources` (name, format, size, download link). Useful for a situation report: who published it, how fresh it
  is, its license.
- **Files are not readable from a browser.** A resource's download link redirects (302) to a signed Amazon S3
  address, and the first answer allows only `https://data.humdata.org` as origin, so a browser on another origin
  cannot follow it. A "show this file on a map" button therefore needs a Worker proxy (with its size limit,
  allow-list of hosts and abuse risk: anyone with a board link could use it), which is a separate decision. A card
  can link to the files without it.
- **HAPI already links to HDX datasets** (`metadata/resource`, shown by the country widgets), so those datasets
  can be named on the board today; a card would let a person paste any dataset.
- **Open questions:** dataset names can change (the id in the CKAN answer does not; the card could store the
  name from the link and show the title it reads); datasets with `is_requestdata_type` (files on request) or
  `private` answer differently, which was not tried; `dataset_date` needs parsing for display.

Estimate if wanted: about a day, on the shape of the IFRC GO card (parse, canonical link, `package_show`, a summary
of the metadata, a link per resource). The open parts are datasets that need a request or are private, and showing
`notes` (Markdown) as text.
