# Script-to-cut benchmark v1 — prepared 30 October 2026

Status: **input pack prepared and checked; product comparison not yet run**.
This is the benchmark preparation authorized before further assembly development.
No new assembly feature is implemented; package version remains 0.12.0.

## Pack

The generated material is outside the source repository:

`/Users/ln-mini/Downloads/opencut-benchmarks/script-to-cut-v1-20261030/`

- `input-pack.zip`: portable, identical inputs for each system. Only `input-pack/`
  is included; evaluator data and the reference plan are excluded.
- `input-pack/brief.txt`: exact first request; `script.md` and `script.txt` hold
  the supplied wording.
- `input-pack/media/`: 13 generated assets for the fictional Harbor workflow
  product: eight full-frame images (including an alternate and distractors), two
  14-second demonstration videos, a logo, narration and a harmonic music bed.
- `input-pack/narration.srt`: 21 measured sentence cues. The seven passages span
  **69.889563 seconds**. Timing comes from locally synthesized utterances and
  known silent gaps, not estimated word timings or transcription.
- `input-pack/assets.json`: portable descriptions, probes, dimensions/streams and
  media hashes. No private footage, person recording or supplied DB logo is used.
- `evaluator-only/`: reference scene/time ledger, input hashes, unfilled scorecard,
  revision challenges, contact sheet, sampled video frames and validation evidence.
- `runs/opencut-reference/`: an unselected, agent-authored v2 reference draft and
  review manifest. This is custom plan preparation, not an integrated agent run.

The macOS Samantha voice generated narration locally at 165 words/minute. All
graphics and demonstration motion are code-generated; music is a synthesized
harmonic bed. No model API, stock download, voice download or external upload was
used. Rendered fixture source videos are inputs, not a rendered assembled cut.

## Fair comparison procedure

Give both systems only the input pack and the same brief. Do not provide the
evaluator ledger, reference plan or expected visual choices to one system.

1. Start a fresh project/context and record app, agent/model and version. Measure
   wall time and human interventions beginning with the first request.
2. Ask for a reviewable editable first draft using supplied narration unchanged,
   relevant images/video, quiet music, logo and English captions. First evaluate
   the draft before correcting it. Live editor playback is not a final export.
3. Record missing/irrelevant scenes, narration changes, timing gaps and correction
   effort. Alternative relevant visual choices can pass; there is no single
   mandatory edit hidden in the evaluator ledger.
4. Run the revision prompts below in order, preserving the earlier revisions.
5. Only after the applicable visible preview/final actions, measure rendered audio,
   captions and export quality. Compilation alone cannot earn those points.
6. Record uploads/proxies/providers and verify input hashes stayed unchanged.

This is a **timed-caption condition**, isolating assembly/revision behavior. A
later alignment condition should omit captions in a separately versioned pack for
both systems. Synthetic fixtures do not establish performance on real interview
speech, faces, cinematography or camera codecs.

## Revision challenges

| Request | Expected behavior |
| --- | --- |
| Replace the ownership visual with the supplied alternate; lock narration, opening and closing | Confined visual change; no timing or unrelated-scene drift |
| Make it 45 seconds while retaining every word, pause, order and original narration speed | Recognize the contradiction and ask which constraint may change |
| Use the supplied mobile-app demo in the closing | Notice that no mobile demo exists and ask/offer an explicit available alternative |

## Scoring

| Category | Points |
| --- | ---: |
| Script and narration fidelity | 20 |
| Visual relevance | 20 |
| Timing and coverage | 15 |
| Conversational revisions and locks | 15 |
| Audio mix | 10 |
| Captions | 10 |
| Correction effort | 5 |
| Data handling | 5 |

Hard failures include unapproved external activity, silent narration truncation or
speed change, invented source media, lock violations, or false success on the
infeasible duration request. Scores remain **null/not-run** until evidence exists.

## Verification actually performed

- Executed the preparation script with the installed local Bun, Sharp, FFmpeg,
  FFprobe and macOS speech tools. It refuses to overwrite an existing pack.
- Probed all 13 media assets. Both videos are 14 seconds; reference source ranges
  are shorter than their available durations. Narration and music lengths match.
- Checked all 19 input-file hashes and ZIP contents against the same hash ledger;
  evaluator/reference material is excluded from the archive.
- Inspected the contact sheet and video sample frames. Input audio mean/peak:
  narration −19.2/−4.6 dBFS; music −31.0/−23.0 dBFS. These are input levels, not a
  completed output-mix test.
- Reference plan passed v2 schema parsing, compilation and the bundled independent
  session validator. Preflight reports **14 pass, zero warnings and one expected
  selection blocker**. The draft remains unselected; no approval gate was bypassed.
- Bridge TypeScript check passed. Documentation links/whitespace checked. No full
  application test suite was rerun for this fixture-only pass.

An initial preparer assertion wrongly expected an unselected candidate to have
zero preflight blockers. The preparer was corrected to require the existing
selection gate and reject other content blockers. No application gate was changed.

## Current trial status and limits

**Kino:** not run. No Kino desktop installation was found in the normal local app
locations, and no Kino connector is available in this session. No browser account
was accessed or app installed. A signed-in product connection and review of its
proxy/AI-credit behavior are needed before the live test. Use only this generated
pack for that test; no podcast transfer is needed.

**OpenCut:** reference prepared and compiled, no cut preview/final rendered and no
score awarded. Reference uses quiet static music: the existing renderer cannot
yet duck music against a separate voiceover. That limitation is explicitly
recorded rather than treated as passing narration-aware ducking.

Existing podcast projects and their media were not modified or imported into this
benchmark. The normal studio/runtime was not restarted or repointed.

## Reproduce preparation

From `apps/agent-bridge`, on a Mac with Samantha already installed:

```sh
./node_modules/.bin/bun run benchmark:prepare /absolute/path/to/a/new/benchmark-folder
```

The output directory must not exist and must be outside the source checkout. The
generator creates fixture inputs and a reference plan; it never renders a cut or
installs/configures Kino. Speech timing is measured anew and may vary with the
installed system voice version. Give both systems the same generated archive.
