# Feature-page keyword targets (Google Search Console, 2026-07-31)

Source: GSC exports for cocalc.com (12 months) and cocalc.ai (3 months),
filtered to pages matching `/features/`, queries excluding "cocalc"
(non-branded discovery only). Raw CSVs live outside the repo.

## Page ranking (clicks, non-branded)

cocalc.com (12 mo): terminal 94k, jupyter-notebook 56k, sage 20k,
linux 5.5k, latex-editor 4.9k, octave 566, python 510, julia 505,
r-statistical-software 90. Everything else ~0.

cocalc.ai (3 mo): terminal 402 (pos ~11), sage 132 (pos ~6), jupyter 33
(pos ~18), linux 29 (**pos ~41**), latex 13 (pos ~29), julia 4, r 1.

## Query families and the phrasing that ranked

- **Terminal** (dominant): "online linux terminal", "linux terminal
  online", "online terminal", "online ubuntu terminal", "virtual linux
  terminal" (24% CTR), "linux console/shell/cli online", "online linux
  terminal for practice free", "webminal" (competitor name).
- **Jupyter**: "jupyter notebook online", plus a large "compiler" family:
  "jupyter notebook online compiler", "online jupyter compiler" (17–22%
  CTR). Also "jupyter notebook online free", "python notebook online".
- **Sage** (best positions on cocalc.ai already, ~2.5–3): "sagemath
  online" (17% CTR at pos 2.5), "sage math", "sagemath online compiler"
  (23–42% CTR on the compiler variants), "sagemath notebook",
  "sagemath online free". Note: "sagemath cell" / "sagemath cell
  server" queries refer to SageMathCell (https://sagecell.sagemath.org/),
  an independent service — "part of the family" (it links to us) but
  nothing to do with CoCalc, so per Harald we do NOT optimize for them.
- **Linux**: "linux environment online" (**39.7% CTR at pos 2.1**,
  best CTR of all), "online linux environment" (35%), "linux online",
  "online linux compiler", "linux simulator", "ubuntu terminal online",
  "linux for practice".
- **LaTeX**: "online latex editor" (pos ~10, 2.8% CTR — the page ranked
  but converted poorly), "latex online".
- **R**: small but well-positioned: "r online statistical software"
  (pos 2.6), "r statistical software online" (pos 3.6). The generic
  "r statistical software" ranked poorly (pos 23).
- **Octave**: "octave online" — 64k impressions at pos 8.5 with only
  0.5% CTR; big untapped potential for a later pass.
- **Python**: 192k impressions at pos 22, 0.27% CTR — weak page, later.

## Copy implications applied

- The word "**online**" belongs in metadata titles and hero copy;
  "free", "no install/nothing to install", "in your browser" support it.
- The "**compiler**" family converts extremely well for sage/jupyter
  even though technically it's an interpreter; use natural phrasings
  like "type code, run it, see the output" and at most one tasteful
  "looking for an online X compiler" mention.
- metadataTitle set: sage = "Use SageMath Online" (the exact old
  cocalc.com title that held pos 2.5), r-statistical-software =
  "R Statistical Software Online". linux already "Online Linux
  Environment", terminal already "Online Linux Terminal".
- Linux page: "environment" framing (matches the top-CTR query),
  mention compiling C/C++ with gcc and practicing Linux safely.
- Sage page: focus on "sagemath online" + notebook/compiler phrasings;
  no SageMathCell angle (separate independent service).
- **Trademark: never write "RStudio" in marketing/feature-page copy.**
  Posit (the company behind RStudio) publishes special trademark terms
  for marketing use, so public pages say "browser-based R IDE" or
  similar instead. This is RStudio-specific: naming Shiny, Overleaf, or
  VS Code is fine. (Product UI/docs are a separate concern.)
