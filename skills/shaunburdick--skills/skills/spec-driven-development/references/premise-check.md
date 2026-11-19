# Premise Check

A claim about a third party's behaviour ("GitHub does not record X") is a guess
until you fetch the endpoint and read the response. One `curl` or one doc
lookup. Record the response shape in `research.md`.

If a premise cannot be verified, do not specify on it. An unverified premise
encodes a guess into the spec, and every FR derived from it multiplies the cost
of the guess.

## A premise that was half right

A real example: GitHub's
issue-event object does carry `actor` ("the person who generated the event"),
so a design that assumed issue history could not be attributed was wrong — but
`commented` events do _not_ use that common shape and carry `user` instead. An
implementation reading `event.actor.login` would work on most events and return
null on every comment. One API read surfaces both halves; a memory-only
assumption surfaces neither.
