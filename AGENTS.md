# Fork development instructions

- This is Laksh-star's OpenCut fork. Preserve the agent bridge, local review UI,
  immutable revisions, and separate preview/final approval steps when syncing upstream.
- `shiplog.md` is the development record. Update it in every meaningful development
  pass, including the date, user-visible changes, validation actually performed,
  and any remaining limitations. Distinguish planned, implemented, tested, and
  published work; never claim a release or runtime test solely from a commit.
- Keep historical shiplog entries factual. The initial retrospective was reconstructed
  from Git and project records; do not invent start dates or verification evidence.
- Keep user media and generated review artifacts outside the source repository.
- Use independent dependency directories per checkout. Keep the FFmpeg CLI backend
  until a separately tested native adapter can replace it.

- Keep current documentation aligned with user-visible changes: `README.md`,
  `FEATURES.md`, and the relevant main-editor, clip-review or bridge guide. Use
  `DOCUMENTATION.md` as the map. Keep historical reports and verification results
  explicitly dated; do not rewrite old test outcomes as fresh validation.
