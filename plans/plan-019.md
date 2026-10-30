# Plan 019: GitHub issues and pull requests on the board

Status: built (card, no private repositories).

Someone pastes a link to a GitHub issue or pull request, and a card shows a summary and its status. For the team
using the board to plan and track work (feedback, tickets); it is not part of the exercise participants' sitrep
workflow, so it is one small widget, not a general link importer. If participants need other links unfurled
(ReliefWeb, HDX), generalize it then.

## Decisions

- **The board stores the link, nothing else** (the rule for every widget: store references, not data). A `github`
  object has an optional `url`, always `https://github.com/<owner>/<repo>/issues/<n>` or `/pull/<n>`. The op
  `github.setUrl` takes any spelling a person pastes (`/files`, `#issuecomment-…`, `www.`, `http`) and stores the
  canonical one, so two spellings of one item are one string. `github.add` takes only the canonical form.
- **Browsers read `api.github.com` directly.** It sends `Access-Control-Allow-Origin: *`, so no Worker route and no
  secret. Cost: unauthenticated requests are limited to 60 an hour per IP address, and a team in one office shares
  that. An issue costs 2 requests (the issue, its timeline), a pull request 3 (the pull, check runs, commit status);
  answers are cached per page and the refresh button asks again. A reached limit is reported with its reset time.
  A token would raise it to 5,000 an hour but would have to live in the Worker, which then reads for everyone with
  the board link. The Worker proxy is the way to add one later, with the private-repository decision.
- **Public repositories only.** Private ones answer 404; the card says only public ones can be shown. Reading a
  private repository through a Worker token would show its issues to anyone with the board link (there is no access
  control on boards).
- **Status.** Issue: open, closed, or closed as not planned. Pull request: draft, open, merged or closed, with
  one checks result from the head commit: failing if any check run failed (timed out, cancelled and action required
  count) or the commit status failed, else running if any is not finished, else passing; nothing is shown for a
  commit with no checks, or when both requests failed. GitHub reports a commit with no statuses as `pending` with a
  total of 0, which is read as none.
- **Linked pull requests.** For an issue, the pull requests in its timeline's `cross-referenced` events (newest
  first, each once, at most 5, from any repository). The REST API does not say which of them close the issue
  (GraphQL's `closedByPullRequestsReferences` does, but needs a token), so the card says "mention it". A failing
  timeline request leaves the list out, not the card.
- **A link to an issue that is a pull request** (GitHub serves both at `/issues/<n>`) is shown as a pull request.
- **Text.** The first 280 characters of the body as plain text (template comments, images, code blocks, tags and
  markdown marks removed). Never rendered as HTML or markdown, since the page shares the board's origin.
- **The agent** can add a card and set its link (ops are tools). It cannot read the item: that would need a
  read-only tool in the room's Worker (`ToolDef`), which shares the same rate limit.

## Not built

Review state of a pull request; which pull requests close an issue; private repositories and a token; GitHub
Enterprise; pasting a link on the bare canvas to make a card (the card's own field takes it today).
