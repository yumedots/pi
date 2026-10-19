# PLAN — snapcompact plugin

Goal: deterministic, no-LLM-call compaction that archives dense content as bitmap
frames in context, at minimum token cost. Plus an on-disk conversation archive for
on-demand recall.

## The three pieces

- **maskpoint** — drops stale observations.
- **snapcompact** (this plugin) — frames the dense remainder, in-context.
- **archive** — full conversation on disk; searched only as a fallback.

## Pipeline (per compaction)

1. Intercept the compaction hook; take the messages being compacted.
2. Prune stale/redundant observations (fewer frames).
3. Serialize + normalize conversation to text; cap per-tool-result chars.
4. **Density gate**: measure chars/token; frame ONLY where framing wins
   (JSON, tool output). Leave code/prose as text.
5. Render PNG frames with `@napi-rs/canvas`; provider-tuned geometry
   (Anthropic `11on16-bw` = 4.23 chars/token); pack to frame capacity.
6. Attach frames as image content to the compaction summary.
7. Append the full pre-compaction conversation to
   `~/.pi/agent/archive/<session>/<ts>.md` (zero tokens).
8. Cache frames by content hash; cap frame count + archive bytes.

## Token-cost levers (impact order)

1. Density gate (skip unprofitable content).
2. Pre-prune stale content (less to frame).
3. Optimal geometry / max chars per frame (fewer frames).
4. Higher density margin.
5. Frame caching.

## Frames first, archive fallback

- Archive is **pull-only**; never auto-injected.
- Exposed as a dedicated tool (`archive_search`), not raw `grep`, so its
  description carries the rule: *"The compacted frames are already in your context
  and current; search this archive ONLY if the frames don't answer it."*
- The compaction output states the frames are the full history.

## Notes

- "Image tokens" = cost of a vision model **reading** a frame (not generating).
  Frames render locally (CPU, zero tokens); the conversation model must accept
  image input.
- Fast renderer: `@napi-rs/canvas` (Skia N-API, prebuilt).
- Lives in-repo at `plugins/snapcompact/`, wired via `settings.json` `extensions`.
