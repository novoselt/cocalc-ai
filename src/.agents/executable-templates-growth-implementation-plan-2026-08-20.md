# Executable Templates Growth Implementation Plan

Date: 2026-08-20

Status: Proposed implementation plan

## Executive Summary

Build a curated catalog of useful, indexable, executable CoCalc templates at
`/templates`. Each template gets a substantive public page that is useful even
before signup, a tested immutable content release, and a primary **Run this in
CoCalc** action. A signed-out visitor can create an account and continue into
the exact released template without losing intent. A signed-in visitor gets a
new project on an appropriate bay and host, with the selected RootFS, files,
precomputed outputs, and intended entry file ready to use.

This is not a revival of arbitrary indexable public shares. User-created public
directory shares remain unlisted, signed-in, and outside the search index. Only
admin-approved template releases may appear in the catalog or sitemap. That
separation is the main spam, security, and search-quality boundary.

The initial launch should contain a coherent catalog of at least 12 excellent
templates and have all 30 templates below in active production, review, or
scheduled release. Shipping one or two thin examples will not test the idea and
will recreate CoCalc's historical failure mode of implementing only a small
fraction of the acquisition loop.

## Why This Is Different From the Existing Landing Pages

The current feature pages are broad product pages. They explain why somebody
might use CoCalc for Jupyter, Python, R, Julia, SageMath, LaTeX, Linux, a
terminal, teaching, or Codex. They should remain the authoritative topic hubs.

An authoritative template page answers one narrow practical question end to
end. For example, **Analyze a CSV in Python with pandas** should contain:

- a plain-language description of the task and when it is useful;
- a viewable excerpt of the actual code and its output;
- enough explanation that the page has standalone educational value;
- exact software/runtime information and a recent successful validation date;
- a small licensed sample dataset when one is needed;
- a screenshot or static rendering of the finished result;
- a one-click path to a working copy in CoCalc;
- related templates, the broader Jupyter/Python feature page, and relevant
  documentation;
- an explicit author, license, and source/version history.

This is closer to the useful part of Overleaf's template gallery than to a
keyword landing-page generator. It must not produce many near-duplicate pages,
programmatic keyword permutations, or pages whose only value is a signup
button. Each indexed URL represents a maintained deliverable that a visitor can
inspect and run.

## Evidence and Baseline

The implementation should preserve the baseline in the growth dashboard at
launch so subsequent changes are attributable:

- In the seven days ending 2026-08-20, CoCalc had 2,916 legitimate signups,
  essentially flat week over week.
- Google organic produced 1,076 of those signups and was the largest known
  acquisition channel.
- Google-acquired users were relatively strong: about 84% created a project
  and 69% reached meaningful work.
- Existing Jupyter landing traffic had very high downstream quality in the
  observed sample: about 98% created a project and 76% reached meaningful work.
- Search Console history shows meaningful demand for online terminals,
  Jupyter, SageMath, Linux environments, LaTeX, Python, Julia, R, and Octave.
- Existing public-share traffic is low quality and tiny. It should not be used
  as evidence that curated executable content cannot work; the current shares
  are unlisted, require sign-in, are not designed as acquisition pages, and do
  not provide a catalog-to-run loop.

Templates are therefore intended to expand high-intent organic acquisition,
not merely increase raw page views. The main outcome is retained meaningful
users per template, not indexed URL count.

## Product Principles

1. **The public page must be genuinely useful.** A visitor can understand the
   workflow, inspect real code and output, and decide whether it fits before
   creating an account.
2. **Run means run.** The button produces the exact reviewed release, not a
   blank project with a suggestion to reconstruct it.
3. **A template release is immutable.** Editing the authoring source creates a
   new release; it never silently changes an existing release.
4. **Runtime and content are separate.** RootFS supplies software. A template
   artifact supplies HOME files, generated output, metadata, and the entry
   point.
5. **Official catalog and user sharing are separate trust lanes.** A user
   cannot make content indexable by adding a tag or choosing a slug.
6. **The destination project belongs where the user's projects belong.** It is
   not pinned to the template authoring project's host or bay.
7. **No template requires secrets or network access to become useful.** Small
   datasets are vendored with licenses. Optional live-data steps come later.
8. **Every release is continuously tested.** A template that no longer runs is
   automatically removed from recommendation and eventually from new
   instantiation until fixed.
9. **Template analytics contain no notebook, prompt, source-code, or document
   content.** Only identifiers, states, timings, and bounded classifications
   are recorded.
10. **Templates lead into normal CoCalc.** They do not create a separate toy
    execution service or a second project UI.

## Existing CoCalc Building Blocks

The implementation should extend these systems rather than duplicate them:

- Public feature routes and pages in
  `src/packages/frontend/public/features/`.
- Shared route metadata and sitemap policy in
  `src/packages/util/public-site-metadata.ts`.
- Server-side crawler-visible fallback content in
  `src/packages/hub/servers/app/public-shell.ts` and
  `public-prerender.ts`.
- Runtime image catalog, immutable release identifiers, official status,
  prepull behavior, and public RootFS pages in `rootfs_images`,
  `src/packages/server/rootfs/`, and
  `src/packages/frontend/public/rootfs/`.
- Admin-only onboarding RootFS tags such as
  `onboarding:jupyter-python`, `onboarding:sage`, `onboarding:latex`, and
  `onboarding:code`.
- The typed managed-app catalog in
  `src/packages/util/apps/template-catalog.ts`. Its versioning, validation,
  merging, themes, and verification commands are good precedents, though app
  templates bootstrap services and are not executable content releases.
- Public directory share policy, path validation, safe copy behavior, and
  cross-project copy LROs in
  `src/packages/server/public-directory-shares/`.
- Project creation, load-aware placement, RootFS changes, project startup, and
  recent first-run startup instrumentation.
- Email/SSO continuation targets, which already preserve a safe app-relative
  target through account creation.
- Growth events, acquisition attribution, activity milestones, UX latency
  traces, and `/admin/retention` serving aggregates.
- Static notebook, Markdown, code, board, slide, and task renderers in the
  public viewer. These can inform preview generation but must not expose a live
  arbitrary project as the public template page.

### Existing Mechanisms That Must Not Be Used Directly

`create_project({ src_project_id })` is not the template primitive. It requires
source-project collaboration, keeps the clone on the source host, currently
rejects cross-bay sources, and clones RootFS state and project secrets. Those
semantics are useful for a collaborator cloning a project, but wrong for a
global public template.

Likewise, an unlisted public directory share is not a released template. A
template publisher may use a project as an authoring workspace, but publication
must export a sanitized immutable artifact that no longer depends on the live
source project.

## Initial Editorial Catalog: 30 Exact Titles

These titles are an initial editorial slate, not automatically generated SEO
variants. Search Console should refine wording before release, but every item
below should become a real maintained template unless validation reveals a
product limitation.

|   # | Public title                                                  | Primary deliverable                                               | Runtime selector            |
| --: | ------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------- |
|   1 | Analyze a CSV in Python with pandas                           | Executed Jupyter notebook, sample CSV, charts                     | `onboarding:jupyter-python` |
|   2 | Data Visualization in Python with Matplotlib and Seaborn      | Executed notebook with publication-ready plots                    | `onboarding:jupyter-python` |
|   3 | Linear Regression in Python with scikit-learn                 | Executed notebook with diagnostics and interpretation             | `onboarding:jupyter-python` |
|   4 | Solve Differential Equations in Python with SciPy             | Executed notebook with numerical and plotted solutions            | `onboarding:jupyter-python` |
|   5 | Symbolic Mathematics in Python with SymPy                     | Executed notebook covering algebra, calculus, and exact solutions | `onboarding:jupyter-python` |
|   6 | Monte Carlo Simulation and Confidence Intervals in Python     | Executed notebook with convergence plots                          | `onboarding:jupyter-python` |
|   7 | Numerical Linear Algebra in GNU Octave                        | Scripts, notebook-style explanation, plots, and verified output   | `onboarding:math`           |
|   8 | Collaborative Jupyter Notebook for Team Data Analysis         | Notebook, sample data, review checklist, and collaboration guide  | `onboarding:jupyter-python` |
|   9 | Exploratory Data Analysis in R with tidyverse                 | Executed R notebook and sample data                               | `onboarding:jupyter-r`      |
|  10 | Publication-Quality Plots in R with ggplot2                   | Executed R notebook and exported figures                          | `onboarding:jupyter-r`      |
|  11 | Linear Regression and Model Diagnostics in R                  | Executed R notebook with residual analysis                        | `onboarding:jupyter-r`      |
|  12 | Reproducible R Report with Quarto                             | Source report, data, and rendered HTML/PDF when supported         | `onboarding:jupyter-r`      |
|  13 | Data Analysis in Julia with DataFrames.jl                     | Executed Julia notebook and sample data                           | `onboarding:jupyter-julia`  |
|  14 | Differential Equations in Julia with DifferentialEquations.jl | Executed Julia notebook with solver comparison                    | `onboarding:jupyter-julia`  |
|  15 | Benchmark Julia Code and Understand Performance               | Executed notebook with allocations and timing examples            | `onboarding:jupyter-julia`  |
|  16 | Number Theory Algorithms and Benchmarks in SageMath           | Executed notebook comparing foundational algorithms               | `onboarding:sage`           |
|  17 | Symbolic Calculus and Equation Solving in SageMath            | Executed SageMath notebook                                        | `onboarding:sage`           |
|  18 | Exact Linear Algebra in SageMath                              | Executed notebook contrasting exact and numerical computation     | `onboarding:sage`           |
|  19 | Graph Theory and Network Exploration in SageMath              | Executed notebook with graphs and invariants                      | `onboarding:sage`           |
|  20 | Signal Processing and FFT in GNU Octave                       | Scripts, sample signal data, plots, and verified output           | `onboarding:math`           |
|  21 | Academic Paper in LaTeX with BibTeX                           | Multi-file article, bibliography, figures, and compiled PDF       | `onboarding:latex`          |
|  22 | Beamer Presentation with Figures and Citations                | Beamer source, assets, bibliography, and compiled PDF             | `onboarding:latex`          |
|  23 | Homework Assignment with Worked Solutions in LaTeX            | Instructor and student variants with compiled PDFs                | `onboarding:latex`          |
|  24 | Multi-File Thesis or Dissertation in LaTeX                    | Chapters, front matter, bibliography, and compiled PDF            | `onboarding:latex`          |
|  25 | Python Command-Line Project with pytest                       | Python package, CLI, README, and passing focused tests            | `onboarding:code`           |
|  26 | LaTeX Report with Python-Generated Figures                    | Python script, generated figures, report source, and PDF          | `onboarding:latex`          |
|  27 | Learn Linux Shell Commands in an Online Terminal              | Exercises, sample files, verification script, and README          | `onboarding:code`           |
|  28 | Bash Pipeline for CSV and Log File Analysis                   | Shell scripts, sample inputs, expected outputs, and tests         | `onboarding:code`           |
|  29 | Jupyter Assignment with Automated Checks                      | Student notebook, instructor source, and validation tests         | `onboarding:teaching`       |
|  30 | Computational Mathematics Course Starter                      | Course project structure, sample assignment, and instructor guide | `onboarding:teaching`       |

### Release Waves

**Wave 1: acquisition MVP (12 templates).** Release 1, 2, 7, 9, 10, 13,
16, 17, 21, 22, 27, and 28 together. This covers CoCalc's strongest known
search families and every major product mode except teaching.

**Wave 2: catalog credibility (10 templates).** Release 3, 4, 5, 11, 14,
18, 19, 20, 23, and 25. This makes category pages substantial and creates
useful internal-link clusters rather than isolated pages.

**Wave 3: depth and collaboration (8 templates).** Release 6, 8, 12, 15,
24, 26, 29, and 30 after their heavier interactivity, rendering, or course
semantics pass staging validation.

Do not expose an empty category page. A category becomes indexable only when it
contains at least three released templates with distinct useful content.

## Template Content Standard

Every release must include:

- a concise `README.md` written for the target user;
- a single declared entry point to open after instantiation;
- an expected result already rendered or executed where the format permits;
- commands or notebook cells that reproduce the result;
- a machine-readable validation specification;
- software and dataset provenance;
- licenses for the template and every vendored dataset or asset;
- an expected run time and approximate resource requirement;
- two or three useful extension ideas;
- two or three optional Codex starter requests such as “adapt this notebook to
  my CSV” or “explain why this benchmark scales this way”;
- accessibility checks for headings, link names, image alternatives, color
  contrast, and keyboard-reachable public-page controls.

Initial releases must remain small. Prefer a compressed artifact below 10 MB,
no individual file above 5 MB, under 500 files, and execution under two minutes
on a normal free project. Exceptions require an explicit review and separate
resource class.

### Notebook Standard

- Author in a diff-friendly source such as Jupytext percent format or Quarto
  when practical; build the released `.ipynb` deterministically.
- Give every cell a stable ID.
- Execute from a clean kernel and fail on unexpected errors.
- Keep output bounded; remove progress bars, transient timestamps, memory
  addresses, and environment-specific paths.
- Include concise Markdown interpretation, not just code cells.
- Avoid an external network dependency during validation or first run.

### LaTeX Standard

- Compile from a clean checkout with the released RootFS.
- Include all nonstandard assets and bibliography data.
- Fail publication on missing references, citations, files, or fatal warnings.
- Prefer conservative packages and structures users can understand and edit.
- Generate an accessible public HTML explanation in addition to the PDF
  preview; the PDF alone is not the indexed page.

### Terminal and Code Standard

- Include a safe `check.sh` or focused test command.
- Never require `sudo`, secrets, destructive commands, or writes outside HOME.
- Make scripts idempotent and quote shell inputs correctly.
- Clearly distinguish commands to read from commands to run.

## Data Model

Define the schema once in `src/packages/util/db-schema/`; let db-schema create
and synchronize it. Do not add parallel `CREATE TABLE` initialization in the
server package. Add every durable table to `table-ownership.ts` and keep all
reference fields consistent with the ownership manifest.

### `executable_templates`

Stable catalog identity and mutable editorial state:

- `template_id UUID PRIMARY KEY`
- `slug VARCHAR(96) UNIQUE NOT NULL`
- `status`: `draft`, `review`, `released`, `paused`, or `retired`
- `title`, `short_description`, and `category`
- normalized `tags` and editorial priority
- `current_release_id`
- `indexable` and `featured`
- `created_at`, `created_by`, `updated_at`, and `updated_by`

Only admins may create or change these rows in phase 1. A later vetted-publisher
workflow may submit drafts, but only an admin release can become indexable.

### `executable_template_releases`

Immutable release record:

- `release_id UUID PRIMARY KEY`, `template_id`, and monotonically increasing
  `version`
- title, summaries, article body, category, tags, and search-intent metadata as
  they existed at release
- `rootfs_image_id` and concrete immutable RootFS release/digest resolved at
  publication time
- `artifact_key`, `artifact_sha256`, compressed and uncompressed sizes
- `entry_path`, `entry_kind`, and optional default Jupyter kernel
- preview HTML/image keys and hashes
- validation specification and result summary
- author, publisher, source, license, and dataset provenance
- optional contextual Codex starter requests and prompt version
- `released_at`, `released_by`, `last_validated_at`, and validation status
- withdrawal timestamp, actor, and reason

No update may alter artifact, RootFS, entry point, or public body after release.
Corrections create a new release. Withdrawal only prevents new instantiations;
it does not rewrite existing projects.

### `project_template_origins`

Bay-owned destination fact and idempotency boundary:

- `project_id PRIMARY KEY`
- `account_id`, `template_id`, and `release_id`
- `idempotency_key` unique within account scope
- `status`, failure class, and current durable operation ID
- phase timestamps for project created, artifact imported, project ready, entry
  visible, and failed
- `created_at` and `updated_at`

This row belongs on the destination project's owning bay. It must not be used as
the global template catalog. Long-running phase execution should reuse the
existing durable operation framework rather than invent another polling
protocol.

## Authority and Multibay Design

The template catalog is a site-global, read-mostly control-plane resource. The
seed/global authority owns stable identities and release metadata, and bays may
cache or replicate released rows. The immutable artifact lives in configured
object storage with a content hash. An authoring project remains authoritative
only for its live files before publication.

Instantiation follows this route:

1. Resolve the signed-in account's `home_bay_id`.
2. Select the destination project's owning bay and host using normal project
   placement, including current cache/load-aware placement.
3. Create the destination project on that owning bay.
4. Instruct its project host to fetch the immutable artifact directly from
   object storage using a short-lived scoped credential or trusted artifact
   endpoint.
5. Start and interact with the project directly through the normal project-host
   data plane.

The hub must not stream template archives or steady-state project traffic.
Source and destination are never assumed to share a host or bay. Launchpad is
the one-bay instance of this same design.

## Authoring and Publication Pipeline

Create a new package, tentatively
`src/packages/executable-templates`, containing reviewed manifests,
diff-friendly source, small licensed assets, builders, and validators for the
official catalog. This makes template content amendable through normal pull
requests and allows agents to do most of the production work without hidden
state in an employee's project.

Recommended directory shape:

```text
src/packages/executable-templates/templates/analyze-csv-pandas/
  template.yaml
  article.md
  source/notebook.py
  source/data/example.csv
  expected/summary.json
```

The publisher performs these steps:

1. Validate manifest types and stable slug.
2. Resolve the selected official RootFS tag to a concrete, unblocked image ID
   and immutable release/digest.
3. Build generated files, including notebooks, PDFs, and previews, in an
   isolated temporary project using that exact image.
4. Execute the validation commands from a clean state with network disabled by
   default.
5. Inspect notebook errors, test results, LaTeX logs, exit codes, output sizes,
   and expected result assertions.
6. Strip source-control metadata, caches, sockets, devices, credentials,
   `.ssh`, `.snapshots`, `.local/share/cocalc`, CoCalc internal state, and all
   paths outside the release manifest.
7. Reject absolute paths, path traversal, devices, hard links, and symlinks in
   phase 1. Symlinks can be supported later with explicit within-root checks.
8. Scan for secrets, malware signatures, private keys, access tokens, and
   unexpectedly large or high-entropy files.
9. Create deterministic preview artifacts and a deterministic tar+zstd content
   artifact.
10. Compute hashes, upload immutable objects, insert the release row, and make
    it current in one controlled publication transaction.

Provide both CI validation and an admin CLI such as:

```text
cocalc admin templates validate <slug>
cocalc admin templates publish <slug> --version <version>
cocalc admin templates withdraw <slug> --reason <text>
cocalc admin templates revalidate <slug|--all>
```

Publication is a dangerous admin operation and should use the existing
fresh-auth mechanism and audit log.

## Public Catalog and SEO Architecture

Add public routes:

```text
/templates
/templates/jupyter
/templates/r
/templates/julia
/templates/computational-math
/templates/latex
/templates/linux-terminal
/templates/teaching-and-collaboration
/templates/<slug>
```

Filters remain client state and do not create crawlable faceted URLs. Only the
catalog, curated category pages, and released detail pages enter the sitemap.

### Server Rendering and Metadata

Extend all three existing route layers together:

- `frontend/public/routes.ts` for client routing;
- `util/public-site-metadata.ts` for shared route shape and defaults;
- `hub/servers/app/public-shell.ts` for authoritative dynamic resolution.

Resolve released template metadata on the server with a short anonymous catalog
cache, following the RootFS and news detail-page pattern. Unknown or withdrawn
slugs return a real 404. A transient catalog failure returns 503 rather than an
indexable soft 404. The browser applies the same resolved metadata after SPA
navigation.

Extend `public-prerender.ts` so the initial HTML contains the template's title,
summary, explanatory article, selected code excerpt, result description,
provenance, related links, and run CTA. Today crawler-visible fallback content
is implemented for feature pages only; rendering a title shell and loading all
useful template content only after JavaScript is not sufficient.

Each detail page needs:

- unique title and meta description;
- canonical URL on `cocalc.ai`;
- social image and dimensions;
- appropriate `LearningResource` and, when justified, `SoftwareSourceCode`
  JSON-LD based on actual visible content;
- last validated and software-version information;
- internal links to its category, related templates, relevant feature hub, and
  documentation;
- noindex while in draft/review/paused state;
- sitemap inclusion only while released and indexable.

Do not index arbitrary public shares, search-result pages, filters, run-progress
routes, authoring projects, artifact URLs, or release aliases. A detail page
canonicalizes to the stable slug while showing its current version. Historical
release information may be visible on that page without creating duplicate
indexed URLs.

### Guides and Topic Authority

The current `/guides` page links to content hosted on
`sagemathinc.github.io/cocalc-guides`. Long term, serve or reverse-proxy the most
relevant guides under canonical `cocalc.ai/guides/<slug>` URLs so the templates,
feature hubs, documentation, and guides reinforce one domain. Do this as a
separate controlled migration with canonical tags and redirects; it is not a
blocker for the first template release.

## One-Click Instantiation

Add a dedicated Conat API:

```ts
templates.instantiate({
  release_id,
  title?,
  idempotency_key,
}) -> {
  project_id,
  operation_id,
  entry_path,
}
```

The operation phases are:

1. validate released template and current permissions;
2. resolve account and destination authority;
3. create or recover the idempotent destination project;
4. set the concrete RootFS image;
5. fetch and verify the artifact hash on the project host;
6. extract safely into an empty HOME;
7. start the project, overlapping startup with artifact import where safe;
8. open the declared entry path;
9. report visible readiness separately from background completion.

The run page opens immediately and displays durable phase progress. Refreshing,
opening another tab, or retrying must converge on the same operation and
project. If project creation succeeded but import failed, retain the project,
offer a retry, and never create a duplicate. A user can change RootFS later
using normal project settings; the origin release remains recorded.

### Signed-Out Continuation

The CTA for a signed-out visitor targets an app-relative run route, for example:

```text
/auth/sign-up?target=/templates/analyze-a-csv/run?release=<release-id>
```

The existing email and SSO continuation target preserves this route. The run
route records the explicit pre-auth click and starts the idempotent operation
after authentication. Do not overload `first_run_onboarding_intent_v1` with a
template slug. The ordinary Jupyter/Sage/LaTeX intent remains a fallback
classification, while the exact immutable release is carried by the safe
continuation target.

The first-run blank-project wizard must yield to this deep-linked run flow. If
the template becomes unavailable during signup, explain the failure and offer
the matching normal onboarding path rather than dropping the user at an empty
project list.

## Security and Abuse Controls

- Only admin-released templates can be public, indexable, or instantiable
  without source-project collaboration.
- Adding `template`, `official`, or `onboarding:*` tags to a user project or
  share grants no catalog authority.
- Never copy project secrets, collaborators, backups, snapshots, writable
  RootFS state, SSH keys, tokens, hidden CoCalc state, or source project IDs
  into the destination artifact.
- Extraction must enforce path normalization, byte/file limits, file types,
  owner/mode normalization, decompression-ratio limits, and exact SHA-256.
- Static preview generation must sanitize HTML and never execute viewer content
  in the cocalc.ai origin with ambient credentials.
- Public artifact downloads use immutable cacheable URLs without account
  credentials; non-public draft artifacts require scoped access.
- Apply account project limits, signup abuse controls, and normal project
  resource limits. Template instantiation is not a way around them.
- Rate-limit anonymous catalog enumeration and authenticated instantiation.
- Record publish, withdraw, revalidate, and admin override actions.
- Keep arbitrary public directory shares unlisted and noindex. Do not add a
  “list this share in templates” checkbox.

## RootFS Selection, Prepull, and Staleness

Template manifests refer to a semantic official RootFS selector during
authoring, but publication resolves it to a concrete image ID and immutable
release/digest. This avoids changing the runtime beneath an existing template
release when tags move.

Before publication and revalidation, require that the image is:

- official, visible, unblocked, and not deleted;
- compatible with the required architecture and GPU class;
- covered by a matching `onboarding:*` convention or explicit approved
  template-use metadata;
- configured for prepull when the template is a featured acquisition path.

The current RootFS code already treats official onboarding-tagged images as
prepull candidates. Extend prewarm monitoring to report template releases by
image and host cache coverage. Placement should prefer a healthy same-region
host with the image cached while preserving load and capacity constraints.

When a RootFS release is withdrawn, stop new template instantiations that
reference it, select a replacement for the next template release, and retain
existing projects. Never silently point an immutable template release at a
different image.

## Acquisition and Product Analytics

Extend attribution landing groups with `template`, plus bounded template
category and release dimensions. Preserve the first anonymous attribution row
through signup as today.

Record unsampled semantic events:

- template catalog impression;
- template detail view;
- run CTA click;
- auth started and completed from a template continuation;
- instantiation started, project created, artifact ready, entry visible, and
  failed;
- first execution or edit;
- first self-directed work;
- D1/D7 project engagement and retained meaningful work.

Record UX latency phases for click-to-run-page, project create, host placement,
artifact fetch/extract, project ready, entry visible, notebook visible, and
first successful execution.

Properties are allowlisted classifications such as template ID, release ID,
category, acquisition channel, outcome class, and RootFS cache class. Do not
record filenames beyond the released entry class, source text, notebook
content, user edits, or prompts.

The primary report is not “template page views.” It is:

```text
retained meaningful users by template, release, acquisition channel, and week
```

Secondary funnel reports:

- search impression -> page visit -> run click;
- run click -> completed signup;
- completed signup -> entry visible;
- entry visible -> meaningful work;
- meaningful work -> D1/D7 engagement;
- project-ready and entry-visible latency percentiles;
- failure class and RootFS cache/host placement correlation.

Suppress small segmented retention cells using the existing growth privacy
rules. Keep serving queries bounded and pre-aggregated so `/admin/retention`
remains fast.

## Reliability and Maintenance

Run every released template nightly in staging and at least daily through a
small production canary that does not enter growth cohorts. Revalidate whenever
its RootFS image, builder, renderer, or relevant project-host code changes.

Health states:

- `healthy`: latest validation passed;
- `degraded`: preview or nonessential check failed, but instantiation is safe;
- `blocked`: core execution/import failed; remove Run CTA and recommendation;
- `withdrawn`: an operator intentionally disabled new use.

Alert on consecutive failures, rising instantiation failures, P95 entry-visible
latency regression, hash mismatch, missing artifact, preview sanitizer failure,
RootFS withdrawal, or category pages falling below the content threshold.

Display “Validated on <date>” publicly. A stale validation is visible to admins
and eventually blocks new runs; it must not remain silently green forever.

## Implementation Phases

### Phase 0: Contracts and First Content

1. Define manifest and release types with JSON-schema or equivalent runtime
   validation.
2. Scaffold the content package and build harness.
3. Produce templates 1, 16, 21, and 27 end to end as internal fixtures.
4. Establish deterministic notebook, LaTeX, and shell validation.
5. Review licenses and editorial standards before building the catalog UI.

Exit criterion: four artifacts validate reproducibly from a clean project using
their concrete RootFS releases.

### Phase 1: Immutable Publication and Instantiation

1. Add db-schema tables and ownership classifications.
2. Add object-storage artifact publication, hashing, scanning, and withdrawal.
3. Add the dedicated instantiate RPC and durable operation.
4. Route by account/project authority and import directly on the project host.
5. Implement idempotent recovery and visible progress.
6. Add focused unit, integration, multibay, and archive-extraction security
   tests.

Exit criterion: a signed-in staging user can repeatedly run all four fixtures
without duplicates, secret leakage, same-host assumptions, or manual recovery.

### Phase 2: Public Catalog and Signup Continuation

1. Add `/templates` routes, catalog, categories, and detail pages.
2. Add dynamic metadata, crawler-visible body, real 404/503 behavior, and
   sitemap entries.
3. Preserve exact release intent through email and SSO signup.
4. Bypass blank-project onboarding for a template continuation.
5. Add public-page accessibility and metadata tests.
6. Add full acquisition and latency instrumentation.

Exit criterion: a signed-out crawler sees useful HTML, and a human can discover
a template, create an account, and land in its ready entry file without a
second choice.

### Phase 3: Twelve-Template Acquisition Launch

1. Finish and review all Wave 1 content.
2. Run a full staging matrix across desktop/mobile, email/Google SSO, new and
   existing accounts, cold/warm images, and at least two bays.
3. Verify all feature-page and category internal links.
4. Add the released URLs to the sitemap and submit them through Search Console.
5. Monitor crawl, conversion, project-ready latency, and failure classes daily
   for the first two weeks.

Exit criterion: 12 healthy templates, no empty category, P95 entry-visible
latency below 15 seconds for cached images and below 30 seconds cold, and no
critical security/reliability findings.

### Phase 4: Complete the 30-Template Catalog

1. Release Waves 2 and 3 on a fixed editorial schedule.
2. Add template-related Codex adaptation requests using the contextual Codex
   plan, without auto-submitting anything.
3. Add related-template recommendations based on editorial links, not opaque
   engagement optimization.
4. Add category-level Search Console and retention review.
5. Remove or rewrite pages that do not earn impressions, links, runs, or useful
   work after enough crawl time; improve strong pages instead of generating
   more thin variants.

Exit criterion: all 30 releases healthy, all categories substantive, and every
template has a named maintainer and automated validation.

### Phase 5: Carefully Expand Publishing

Only after the official catalog is operational:

1. Allow vetted organizations or instructors to submit non-indexed drafts.
2. Add human review, licensing, provenance, and trust scoring.
3. Promote exceptional submissions through an explicit admin release into a
   separate approved-community lane.
4. Keep ordinary user shares unlisted and non-indexable regardless of tags,
   popularity, or backlinks.

## Validation Plan

### Unit and Contract Tests

- manifest normalization, slug uniqueness, and immutable release behavior;
- RootFS selector resolution and blocked/withdrawn states;
- archive allow/deny paths, traversal, links, devices, file counts, and sizes;
- deterministic hashes and preview sanitization;
- safe auth continuation targets and idempotency keys;
- route parsing, metadata, canonical paths, noindex, 404, and sitemap rules;
- table ownership and reference consistency.

### Integration Tests

- publish from source, destroy the authoring project, and still instantiate;
- instantiate into same and different bays from the publisher;
- concurrent duplicate requests converge on one project;
- refresh/restart during every durable operation phase;
- unavailable object storage, hash mismatch, full host, stopped host, and
  RootFS withdrawal;
- signup through email code, email link, password, passkey, and Google SSO;
- source project contains secrets/internal state and none reach the artifact;
- notebook executes, LaTeX compiles, shell checks pass, and expected previews
  match.

### Browser and Accessibility Tests

- public catalog at 320 CSS px and 200% zoom;
- keyboard-only catalog, modal/progress, signup, and project entry;
- semantic headings, links, buttons, status messages, and live-region progress;
- no focus loss across auth redirect and run progress;
- reduced-motion behavior;
- useful crawler-visible HTML with JavaScript disabled;
- mobile signup continuation and project open.

### Staging Acceptance

For every Wave 1 template, an operator should execute this script manually:

1. arrive from an anonymous template detail URL;
2. inspect code/output without signing in;
3. click Run;
4. create an account and verify email;
5. observe immediate durable progress;
6. land in the declared entry file;
7. rerun or compile successfully;
8. edit something meaningful;
9. refresh at several phases and confirm recovery;
10. confirm the growth and latency events contain no content.

## Success Criteria

Within 90 days of the 12-template launch:

- all released pages are indexed without soft-404, duplicate, spam, or manual
  action penalties;
- non-branded organic clicks to template and linked feature pages grow
  materially over the pre-launch baseline;
- at least 8% of template detail visitors click Run;
- at least 35% of signed-out Run clickers complete account creation;
- at least 90% of authenticated instantiations reach entry-visible;
- at least 65% of entry-visible new users reach meaningful project work;
- template-acquired D1 project engagement is no worse than Google organic as a
  whole and trends above the site baseline;
- P50 cached-image entry-visible is below 6 seconds and P95 below 15 seconds;
- no arbitrary user content becomes indexable through this system;
- every released template passed automated validation within the previous
  seven days.

Targets should be reviewed once enough denominator exists, but reliability,
security, indexability boundaries, and immutable releases are launch gates, not
aspirational metrics.

## Recommended Decisions

1. Keep `/features/*` as broad topic hubs and create `/templates/*` for narrow
   useful workflows.
2. Launch only admin-approved official templates; defer community indexing.
3. Store released content as immutable sanitized artifacts, never live-clone a
   source project.
4. Resolve semantic RootFS tags to an immutable official image at publication.
5. Use normal account/project authority and load-aware project placement.
6. Preserve exact release intent through the existing safe auth continuation
   target.
7. Ship 12 templates together, then complete all 30 on a fixed schedule.
8. Keep arbitrary public directory shares unlisted and noindex.
9. Judge success by retained meaningful users, not page count or raw signups.
10. Make nightly validation and automatic blocking part of the product from the
    first release.
