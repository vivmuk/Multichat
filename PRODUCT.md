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

- A small Node server (`server.js`, no dependencies) keeps Venice's public model list in memory,
  refreshes it every five minutes, and writes it into the catalogue's HTML. The catalogue needs no
  API key and makes no request of its own on first load.
- The chat and the benchmark lab call Venice straight from the browser with the visitor's own key,
  kept in the browser's storage. The server never sees a key.
- Browser storage can be blocked (a real failure mode seen in practice): every page must still work
  when nothing can be remembered.
- Ratings are a hand-curated table maintained by the author, not a guarantee published by the model
  provider.
- Five surfaces ship together: the model catalogue (index), the chat, the benchmark lab, the API
  guide, and a page of machine-readable endpoints for agents.
- Deployed on Railway from the repository's `main` branch with `node server.js`; no build step, no
  framework. Served as plain files it degrades to reading Venice from the browser.

## Capabilities and Constraints

- Every catalogue row (text, image, video, voice, music, speech-to-text, image edit, upscale,
  embedding, decision) shows its model ID with a one-tap copy and its price. Counts are whatever
  Venice returns today; nothing is hard-coded.
- Prices are printed exactly as Venice reports them. Video rates are absent from `/models`, so they
  are read from Venice's pricing page and labelled as such; a model without a listed rate says so.
- Per-axis content-policy filters, tab aware: Image exposes likeness / filter / NSFW, Video exposes
  likeness / native audio / NSFW, All models exposes likeness / NSFW. Every option shows how many
  models it leaves.
- On video, no model is rated fully open for NSFW; many are rated limited. That asymmetry is real
  and must not be flattened into a simpler claim.
- Back never leaves the site by surprise: a sheet, a tab, a suite or an overlay is one history
  entry, and Back undoes that one step.
- The same catalogue is available to agents as Markdown, JSON and MCP tools, with Venice's
  documentation and OpenAPI spec mirrored alongside.
- One design system: tokens and chrome in `assets/base.css`, shared by every page, light and dark.
- The API key is never a product feature to be designed around: it is a user's own secret, entered
  by them, and it must never be echoed into a page, an error message or a log.

## Brand Commitments

- Name: V's MultiGen AI Chat.
- The app icon set (a speech bubble with an orange spark) is committed and shipped.
- Policy wording is honest by rule: a rating of "Allowed" means *not blocked*, never "guaranteed to
  render". This wording is a commitment, not copy to be tightened for punch.

## Evidence on Hand

- The live catalogue and its curated policy ratings; the benchmark page; the API guide.
- Prices, as reported by the Venice API and its pricing page.
- Absent, and not to be invented: estimated latency or speed figures, user counts, uptime claims,
  benchmarks the app has not run, or any promise about what a model will produce.

## Product Principles

1. A filter must say how many models it leaves standing.
2. Policy claims are ratings, never guarantees.
3. Picking a model and using it belong in the same visit.
4. The phone is a real surface, not a squeezed desktop.
5. No invented numbers, ever.
