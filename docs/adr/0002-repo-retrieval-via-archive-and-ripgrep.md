# Repository retrieval via archive download + local ripgrep

To let the assistant retrieve from a **linked repository**, phase 1 downloads the
repo as a tarball (`GET /repos/{owner}/{repo}/tarball/{ref}`), extracts **only its
markdown files** into an on-disk **snapshot**, and serves the search tool by
running `ripgrep` over that snapshot, returning the whole file when small or a
line window around the match otherwise (markdown-section-aware extraction is a
later refinement). The tarball is a single commit's tree with no git history, so
the snapshot is inherently shallow, lighter than even a `git clone --depth 1`
(which would still carry a `.git` directory). GitHub's only "search inside a repo"
API is code search (`GET /search/code`), which is too limiting for a docs repo:
default branch only, files under 384 KB, ~9 requests per minute, and weak keyword
matching over prose. Downloading the content and searching it locally removes all
four limits, works on any branch, and leaves the markdown on disk as the natural
starting point for the planned RAG phase 2.

## Considered Options

- **Archive download + local ripgrep (chosen).** Full-text/regex search, any
  branch, no size or rate limits, reusable for RAG. Cost: a local snapshot that
  goes stale and consumes disk (trivial for docs).
- **Code search API (`/search/code`) (rejected).** Zero storage, but default
  branch only, 384 KB cap, ~9 req/min, and keyword-only matching that is weak on
  prose. The limits are the whole reason RAG is a later phase.
- **Git Trees + Contents API (rejected).** No persistent storage, but N API
  calls per query and we would reimplement search ourselves. (It would, however,
  let us fetch only markdown blobs; we instead take the one-request tarball and
  drop non-markdown on extraction, accepting that the full archive crosses the
  wire while only markdown lands on disk.)

## Runtime (must work in the production image, not only dev)

The prod image is Nixpacks `providers = ["node"]` — a pure Node runtime with no
system `rg` or `tar`. The design therefore depends on **no system binaries**:

- **ripgrep is bundled as a dependency** (`@vscode/ripgrep`, which ships a
  prebuilt `rg` per platform and exposes `rgPath`). The tool spawns that binary,
  not a `$PATH` lookup, so search works in the stock Node image without modifying
  it. (Adding `rg` via a Nixpacks apt/nix package is the fallback if bundling
  ever proves unreliable.)
- **The tarball is extracted in-process** by streaming `node:zlib` gunzip into a
  tar reader (e.g. `tar-stream`), filtering entries to `*.md` / `*.mdx` /
  `*.markdown` (case-insensitive) and writing only those to disk. No shell-out to
  system `tar`, and non-markdown bytes are discarded rather than stored.

## Consequences

- Snapshots live in a plain directory under the mounted `.data` volume (e.g.
  `.data/repos/`), the same persistent volume backing the prod SQLite file, so
  they survive redeployment and ripgrep has real file paths. NuxtHub Blob is
  avoided because its key-value API is not a directory tree ripgrep can walk. A
  lost snapshot is in any case recoverable by manual refresh.
- Markdown-only snapshots stay small, which keeps the synchronous,
  request-time download+extract (no background worker, per ADR 0001) inside a
  normal request and gives ripgrep less to scan. The trade-off: RAG phase 2 sees
  only markdown; indexing other text would require re-downloading.
- The commit SHA the snapshot was taken at is recorded alongside it, so retrieved
  snippets cite a commit-pinned GitHub URL
  (`/{owner}/{repo}/blob/{sha}/{path}#L{a}-L{b}`). Pinning to the SHA keeps the
  "open source" link line-accurate even after the owner pushes new commits, which
  a branch-anchored link would not.
- Refresh is owner-initiated and manual only (a button); the initial snapshot is
  downloaded at link time. There is no automatic, scheduled, or webhook-driven
  refresh, which keeps the session-only token of ADR 0001 intact. Snapshots are
  therefore as fresh as the last manual refresh.
- The search tool searches all linked snapshots per call (query only, no repo
  argument).
