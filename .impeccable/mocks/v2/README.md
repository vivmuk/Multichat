# Multichat comp set, v2

Comps for the app's four rooms in the agreed design world ("one catalogue, four rooms"), plus the
provider marks pulled from the model vendors. Every image here has a sidecar holding the exact prompt
that produced it, the model, the size, every attempt including rejected ones, the vision QC verdict in
plain words, and the sha256 of the file on disk.

## Rooms

Phone comps are 768x1376 (9:16 at 1K), desktop comps 1376x768 (16:9 at 1K), both via nano-banana-2-lite.

- `home-catalogue-phone.png`, `home-catalogue-desktop.png` — the catalogue
- `chat-phone.png`, `chat-desktop.png` — the chat room
- `benchmark-phone.png`, `benchmark-desktop.png` — the benchmark room
- `api-guide-phone.png`, `api-guide-desktop.png` — the API guide room
- `providers-phone.png` — the provider index, drawn in code (PIL), not by an image model
- `system-sheet.png` — the materials sheet

Read the `vision_qc` field before using a comp as a specification. Two are known imperfect and say so
in their own sidecar: `home-catalogue-desktop.png` (two cards lost their Cost and Native voice rows)
and, to a lesser degree, `home-catalogue-phone.png` (values repeat across cards and the sort line
does not match the order of the costs).

## Provider marks

`providers/` holds one mark per vendor: the original `SVG`, plus `-24`, `-48` and `-96` rasters. Each
raster is cropped to the glyph's own bounding box and scaled to fill 23/24 of the canvas, so marks of
very different aspect ratios share one optical size instead of arriving at whatever size their SVG
happened to use. They are alpha-only, so they take the colour of whatever surface they sit on.

Sources: `@lobehub/icons-static-svg` first (it carries OpenAI, xAI, Z.ai, Moonshot and others that
simple-icons is missing), `simple-icons` as fallback. 30 of 36 vendors have a published mark; Venice,
Inception, Aion Labs, Bria, Inworld and the unattributed remainder have none, and get a hollow tile in
the sheet rather than a made-up logo. The marks remain the trademarks of their owners.

## In the app

The same rasters are copied to `assets/providers/` and printed on the model cards: a small ink mark
immediately left of the model name, no box, no fill, no radius, at 17px from the 48px raster so it stays
crisp on a 2x screen. Vendors with no published mark carry none. `providerOf()` and `providerMark()`
live in `index.html` next to the other card helpers, and the rule is appended to
`assets/card-catalogue.css`.

## Regenerating

Scripts live outside the repo, in `~/.hermes/cache/scratch`:

- `gen_mc_v2.py` — home room, and the brief that the others build on
- `gen_mc_v2c.py` — chat, benchmark and api-guide rooms at phone width
- `gen_mc_desktop.py` — the same rooms at 16:9
- `mc_providers_v2.py` — the provider index sheet
- `mc_app_marks.py` — copies the marks into `assets/providers` and wires them into `index.html`
- `mc_qc_record.py` — writes the QC verdicts into the sidecars
- `mc_bind_all.py` — binds every image to its sha256 and reports drift
- `verify_comps.py` / `mc_verify.py` — re-checks the binding

Every generator writes each attempt to `_staging/` and promotes it with a single rename only after the
blank guard passes, so a rejected render can never land on a final filename. Two blanks and one
healthy-API failure were caught this way.
