# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is Vivek: a hands-on power user who runs an agent fleet, holds an API key, and
browses the whole model catalogue to decide what to use and what to spend on. He uses this on a
phone in one hand as often as on a laptop.

Secondary users are people he shares the link with who need the same catalogue: technical enough to
paste an API key, not necessarily working inside a terminal all day. *[inferred: no interview answer
received this session; the round timed out. The primary user is named in the product's own title.]*

## Product Purpose

One place to see every model the Venice API serves, understand what each one is allowed to do, and
then actually use it — instead of bouncing between a pricing page, a docs page, a policy table and a
separate chat UI.

Success means the reader finds the right model for a task in seconds, understands its licence and
content-policy standing before spending anything, and can run it without leaving the page.

## Positioning

Two things together that a neighbouring catalogue would have to copy as a set:

- **Policy transparency made operational.** Licence/IP standing and content-policy traits (NSFW,
  likeness, native voice, image filter) are attached to each model and exposed as per-axis filters
  that carry live counts, so "what is actually available to me" is answerable rather than guessed.
- **Browse, then use.** The catalogue, the chat, the benchmark and the API guide sit in one app, so
  picking a model and trying it are the same visit.

## Operating Context

- The catalogue is fetched live from the Venice API at load; the key is entered by the user and kept
  in the browser's own storage.
- Browser storage can be blocked (a real failure mode seen in practice): the app must still explain
  itself when nothing can be remembered.
- Ratings are a hand-curated table maintained by the author, not a guarantee published by the model
  provider.
- Four surfaces ship together: the model catalogue (index), the chat, a benchmark page and an API
  guide.
- Deployed on Railway from the repository's `main` branch; no build step, no framework.

## Capabilities and Constraints

- 366 catalogue rows (134 video, 41 image, plus text, voice/TTS and music), each with capabilities
  and any policy ratings it carries.
- Per-axis content-policy filters, tab aware: Image exposes likeness / filter / NSFW, Video exposes
  likeness / native voice / NSFW, All models exposes likeness / NSFW. Options are
  `Allowed (open or limited)`, `Open only`, `Limited only`, `Blocked`, `Unrated`, and for the
  voice and image-filter axes simply Yes / No.
- On video, no model is rated fully open for NSFW: 46 are rated limited. That asymmetry is real and
  must not be flattened into a simpler claim.
- Single-file pages with inline CSS and JS, loaded as plain files; no framework, no bundler, no
  package install.
- The API key is never a product feature to be designed around: it is a user's own secret, entered
  by them, and it must never be echoed into a page, an error message or a log.

## Brand Commitments

- Name: V's MultiGen AI Chat.
- The app icon set (a speech bubble with an orange spark) is committed and shipped.
- Policy wording is honest by rule: a rating of "Allowed" means *not blocked*, never "guaranteed to
  render". This wording is a commitment, not copy to be tightened for punch.

## Evidence on Hand

- The live catalogue and its curated policy ratings; the benchmark page; the API guide.
- Absent, and not to be invented: prices or cost claims, user counts, uptime claims, benchmarks the
  app has not run, or any promise about what a model will produce.

## Product Principles

1. A filter must say how many models it leaves standing.
2. Policy claims are ratings, never guarantees.
3. Picking a model and using it belong in the same visit.
4. The phone is a real surface, not a squeezed desktop.
5. No invented numbers, ever.

## Known defects to fix in this pass

- At phone width the header title overlaps the first icon button.
- The search field's placeholder is cut off on a narrow screen.
