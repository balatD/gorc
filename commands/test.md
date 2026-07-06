Invoke `@go-qa` on the paths most recently edited in this session. If the
session has no tracked edits yet, ask the user (via the question tool) for one
path to review, then delegate that to `@go-qa`.

If `$ARGUMENTS` is non-empty, treat it as the path (or space-separated paths)
to review and delegate exactly those to `@go-qa` instead of the recent-edits
set.

Relay `@go-qa`'s verdict back to the user verbatim. Do not auto-loop into
`@go-implementer` — surface the recommendation and let the user decide
whether to apply it.
