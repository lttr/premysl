# Repository retrieval via archive download + local ripgrep

To let the assistant retrieve from a **linked repository**, phase 1 downloads the
repo as a tarball (`GET /repos/{owner}/{repo}/tarball/{ref}`) into an on-disk
**snapshot** and serves the search tool by running `ripgrep` over that snapshot,
returning the whole file when small or a line window around the match otherwise
(markdown-section-aware extraction is a later refinement). GitHub's
only "search inside a repo" API is code search (`GET /search/code`), which is too
limiting for a docs repo: default branch only, files under 384 KB, ~9 requests
per minute, and weak keyword matching over prose. Downloading the content and
searching it locally removes all four limits, works on any branch, and leaves
the files on disk as the natural starting point for the planned RAG phase 2.

## Considered Options

- **Archive download + local ripgrep (chosen).** Full-text/regex search, any
  branch, no size or rate limits, reusable for RAG. Cost: a local snapshot that
  goes stale and consumes disk (trivial for docs).
- **Code search API (`/search/code`) (rejected).** Zero storage, but default
  branch only, 384 KB cap, ~9 req/min, and keyword-only matching that is weak on
  prose. The limits are the whole reason RAG is a later phase.
- **Git Trees + Contents API (rejected).** No persistent storage, but N API
  calls per query and we would reimplement search ourselves.

## Consequences

- Snapshots live in a plain directory under the mounted `.data` volume (e.g.
  `.data/repos/`), the same persistent volume backing the prod SQLite file, so
  they survive redeployment and ripgrep has real file paths. NuxtHub Blob is
  avoided because its key-value API is not a directory tree ripgrep can walk. A
  lost snapshot is in any case recoverable by manual refresh.
- Refresh is owner-initiated and manual only (a button); the initial snapshot is
  downloaded at link time. There is no automatic, scheduled, or webhook-driven
  refresh, which keeps the session-only token of ADR 0001 intact. Snapshots are
  therefore as fresh as the last manual refresh.
- The search tool searches all linked snapshots per call (query only, no repo
  argument).
