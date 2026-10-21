//! Assistant message component for rendering AI responses.
//!
//! Based on TypeScript implementation:
//! packages/coding-agent/src/modes/interactive/components/assistant-message.ts
//!
//! Renders an assistant message's content blocks **in order** — text blocks
//! as markdown, thinking/reasoning blocks as dim italic markdown, with a
//! spacing rule that mirrors the TS `updateContent` (a blank line between a
//! thinking run and a following visible block). The block model
//! ([`AssistantBlock`]) is a small, provider-free projection so this library
//! crate never depends on `rpi-ai` (project constraint); the host glue in
//! `rpi-cli` maps an `AssistantMessage` into `Vec<AssistantBlock>` and feeds
//! it to [`AssistantMessageComponent::update_blocks`].

use std::any::Any;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::component::{Component, MouseButton, MouseEvent, MouseEventKind, MouseEventResult};
use super::container::Container;
use super::image::{Image, ImageOptions};
use super::loader::{SpinnerCounter, SpinnerTicker, SPINNER_FRAME_MS, SPINNER_FRAMES};
use super::markdown::Markdown;
use super::mouse::{MouseRegion, MouseRegionHandler};
use super::spacer::Spacer;
use super::text::Text;
use crate::ansi::italic;
use crate::theme::theme;

/// A single visible block of an assistant message, in document order. This is
/// the provider-free projection the component renders from — the host maps
/// `rpi_ai::Content::{Text, Thinking}` into these (dropping tool-call / image
/// blocks, which are rendered by their own components).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssistantBlock {
    /// Plain assistant text (rendered as markdown).
    Text(String),
    /// Reasoning / thinking text (rendered as dim italic markdown).
    Thinking(String),
    /// Inline image bytes decoded from the provider's base64 image block.
    Image(Vec<u8>),
}

/// Configuration for assistant message rendering.
#[derive(Debug, Clone)]
pub struct AssistantMessageOptions {
    /// Hide thinking blocks (show the collapsed summary instead)
    pub hide_thinking: bool,
    /// Label to show when thinking is hidden
    pub hidden_thinking_label: String,
    /// Horizontal padding
    pub output_pad: usize,
}

impl Default for AssistantMessageOptions {
    fn default() -> Self {
        Self {
            hide_thinking: true,
            hidden_thinking_label: "Thinking...".to_string(),
            output_pad: crate::output_pad::output_pad(),
        }
    }
}

/// The timing of one thinking run, used for the collapsed summary line.
#[derive(Debug, Clone, Default)]
struct ThinkingRunTiming {
    /// The thinking text last seen for this run.
    text: Option<String>,
    /// When the first chunk of this run arrived (ms).
    started_at: Option<f64>,
    /// When the last chunk of this run arrived (ms).
    ended_at: Option<f64>,
    /// The run's braille frame counter.
    ///
    /// The sign's frame is a counter the ticker advances once per
    /// [`SPINNER_FRAME_MS`], not a function of the wall clock. The counter
    /// lives with the run, so a rebuild of the message cannot restart the
    /// animation.
    spinner_counter: Option<Arc<SpinnerCounter>>,
}

/// Format a duration the way pi formats a tool duration (`3.7s`, `1m 5s`).
pub fn format_tool_duration(ms: f64) -> String {
    let seconds = ms / 1000.0;
    if seconds < 60.0 {
        return format!("{seconds:.1}s");
    }
    let total_seconds = seconds.floor() as i64;
    let minutes = total_seconds / 60;
    let remainder = total_seconds % 60;
    if minutes < 60 {
        return format!("{minutes}m {remainder}s");
    }
    format!("{}h {}m {}s", minutes / 60, minutes % 60, remainder)
}

/// The summary line of a thinking run: `+ Thought · 3.7s` while collapsed,
/// `- Thought · 3.7s` while the block is shown. A run without a measured
/// duration (a message restored from a session) shows no duration.
pub fn format_thought_summary(expanded: bool, duration_ms: Option<f64>) -> String {
    let colors = theme().colors;
    let summary = format!(
        "{} {}",
        colors.accent.fg(if expanded { "-" } else { "+" }),
        colors.thinking_text.fg("Thought")
    );
    match duration_ms {
        Some(duration) => format!(
            "{summary}{}",
            colors
                .muted
                .fg(&format!(" · {}", format_tool_duration(duration)))
        ),
        None => summary,
    }
}

/// Collapsed thinking label with a braille sign in front of it.
///
/// The sign's frame is a counter the ticker advances once per
/// [`SPINNER_FRAME_MS`] — upstream's loader cadence — so the sign advances at
/// the original's rate instead of following the wall clock. The counter lives
/// with the run, not with the label, so a rebuild of the message cannot
/// restart the animation.
struct ThinkingIndicator {
    label: String,
    spinning: bool,
    counter: Option<Arc<SpinnerCounter>>,
    text: Text,
}

impl ThinkingIndicator {
    fn new(
        label: String,
        output_pad: usize,
        spinning: bool,
        counter: Option<Arc<SpinnerCounter>>,
    ) -> Self {
        Self {
            label,
            spinning,
            counter,
            text: Text::new("", output_pad, 0),
        }
    }
}

impl Component for ThinkingIndicator {
    fn render(&self, width: usize) -> Vec<String> {
        let colors = theme().colors;
        let frame = if self.spinning {
            self.counter
                .as_ref()
                .map(|counter| counter.char())
                .unwrap_or(SPINNER_FRAMES[0])
        } else {
            SPINNER_FRAMES[0]
        };
        self.text.set_text(format!(
            "{} {}",
            colors.accent.fg(&frame.to_string()),
            italic(&colors.thinking_text.fg(&self.label))
        ));
        self.text.render(width)
    }

    fn invalidate(&self) {
        self.text.invalidate();
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

/// Component that renders a complete assistant message.
///
/// Mirrors TypeScript AssistantMessageComponent class. Content is rebuilt from
/// [`AssistantBlock`]s on every [`update_blocks`] (and the legacy
/// [`update_text`]), keeping thinking + text in order with TS-faithful spacing.
///
/// [`update_blocks`]: AssistantMessageComponent::update_blocks
/// [`update_text`]: AssistantMessageComponent::update_text
pub struct AssistantMessageComponent {
    /// The message's mutable state, shared with the click handler that
    /// expands a thinking run.
    state: Arc<AssistantState>,
}

/// The mutable state of an assistant message.
///
/// It lives behind one `Arc` because the thinking summary is wrapped in a
/// [`MouseRegion`]: the click handler needs the visibility overrides and the
/// rebuild path, and the component that owns them is the one being clicked.
struct AssistantState {
    /// Content container for message parts (rebuilt per update).
    content_container: Arc<Container>,
    /// Rendering options
    options: Mutex<AssistantMessageOptions>,
    show_images: Mutex<bool>,
    trailing_spacing: Mutex<usize>,
    /// Whether this message has tool calls
    has_tool_calls: Mutex<bool>,
    /// Whether currently streaming
    is_streaming: Mutex<bool>,
    /// Timing of each collapsed thinking run, used for the summary line.
    thinking_run_timings: Arc<Mutex<Vec<ThinkingRunTiming>>>,
    /// The ticker that advances the live braille sign's frame counter.
    ///
    /// It runs while a spinning sign is on screen, so the sign moves at
    /// upstream's cadence whether or not the message is repainted.
    spinner_ticker: Mutex<Option<SpinnerTicker>>,
    /// Per-run visibility overrides (toggled one run at a time).
    thinking_visibility_overrides: Mutex<HashMap<usize, bool>>,
    /// The last blocks rendered (kept so `invalidate`/option changes can rebuild).
    last_blocks: Mutex<Vec<AssistantBlock>>,
    /// Whether the last rebuild put a live braille sign on screen.
    live_thinking_indicator: std::sync::atomic::AtomicBool,
    /// B5e: an optional markdown transformer applied to the raw assistant text
    /// BEFORE it reaches the [`Markdown`] renderer. The host (`rpi-cli`) injects
    /// a closure wrapping any plugin `register_markdown_transformer` handlers
    /// (called as a sync request/response across the cdylib FFI). `None` is the
    /// no-op identity transform, so this render crate gains **no** `rpi-extensions`
    /// dep — only a `Fn(&str) -> String` trait object. The transform fires on
    /// every `rebuild_content` (i.e. once per streaming delta + once on
    /// finalize), so the plugin always sees the latest full markdown; the FFI
    /// call is cheap (a bare fn-pointer invocation + one JSON round-trip).
    markdown_transformer: Mutex<Option<Arc<dyn Fn(&str) -> String + Send + Sync>>>,
}

impl AssistantMessageComponent {
    /// Create a new assistant message component.
    pub fn new(options: AssistantMessageOptions) -> Self {
        let content_container = Arc::new(Container::new());

        Self {
            state: Arc::new(AssistantState {
                content_container,
                options: Mutex::new(options),
                show_images: Mutex::new(true),
                trailing_spacing: Mutex::new(0),
                has_tool_calls: Mutex::new(false),
                is_streaming: Mutex::new(false),
                thinking_run_timings: Arc::new(Mutex::new(Vec::new())),
                spinner_ticker: Mutex::new(None),
                thinking_visibility_overrides: Mutex::new(HashMap::new()),
                last_blocks: Mutex::new(Vec::new()),
                live_thinking_indicator: std::sync::atomic::AtomicBool::new(false),
                markdown_transformer: Mutex::new(None),
            }),
        }
    }

    /// B5e: install a markdown transformer applied to raw assistant text before
    /// the [`Markdown`] renderer styles it. The closure is `Send + Sync` so it
    /// is safe across the streaming-drain + render threads. Idempotent against
    /// `rebuild_content`: callers may set it before the first `update_blocks` or
    /// swap it on a `/reload`; either way the next rebuild re-applies it. A
    /// `None` value clears the transform (identity) — used on a reload that
    /// unregisters all markdown transformers.
    ///
    /// On a transform CHANGE, the last blocks are rebuilt so the new transform
    /// is reflected immediately (mirrors `set_hide_thinking`/`set_output_pad`).
    pub fn set_markdown_transformer(
        &self,
        transformer: Option<Arc<dyn Fn(&str) -> String + Send + Sync>>,
    ) {
        let blocks = {
            let mut cur = self.state.markdown_transformer.lock().unwrap();
            // `Arc<dyn Fn>` has no PartialEq, so we can't short-circuit on
            // "unchanged" like the option setters. Always rebuild: the call is
            // cheap and the rebuild only fires on an explicit set/swap.
            *cur = transformer;
            self.state.last_blocks.lock().unwrap().clone()
        };
        if !blocks.is_empty() {
            self.rebuild_content(&blocks);
        }
    }

    /// Create with default options.
    pub fn default() -> Self {
        Self::new(AssistantMessageOptions::default())
    }

    /// Update the content from a flat block list. Mirrors the TS
    /// `updateContent` ordering + spacing: text blocks render as markdown,
    /// **runs** of consecutive thinking blocks coalesce into one dim-italic
    /// markdown section (joined with `\n\n`), and a blank line separates a
    /// thinking run from a following visible block. When `hide_thinking` is
    /// set, each thinking run collapses to a single dim label line.
    pub fn update_blocks(&self, blocks: &[AssistantBlock]) {
        *self.state.last_blocks.lock().unwrap() = blocks.to_vec();
        self.rebuild_content(blocks);
    }

    /// Update the content with assistant message text.
    ///
    /// Convenience for callers that have only text (the legacy path). The
    /// block-aware [`update_blocks`] supersedes this where thinking blocks
    /// are available; both share the rebuild path.
    pub fn update_text(&self, text: &str) {
        if text.trim().is_empty() {
            self.update_blocks(&[]);
        } else {
            self.update_blocks(&[AssistantBlock::Text(text.to_string())]);
        }
    }

    /// Rebuild the content container from a block list (the shared render path).
    ///
    /// Mirrors the TS `updateContent` loop, simplified to the text/thinking
    /// block pair (tool-call / image / error rendering is owned by other
    /// components: tool-exec blocks render via `ToolExecutionComponent`,
    /// and stop-reason error lines surface through `add_error_message` in the
    /// host). Empty content renders nothing.
    fn rebuild_content(&self, blocks: &[AssistantBlock]) {
        self.state.rebuild_content(blocks);
    }

    /// Toggle one thinking run between the collapsed summary and the expanded
    /// body. Returns the new visibility.
    pub fn toggle_thinking_run(&self, run_index: usize) -> bool {
        self.state.toggle_thinking_run(run_index)
    }

    /// Whether a live braille sign is on screen for a streaming thinking run.
    ///
    /// The sign is drawn from a frame counter, so it only moves when the
    /// message is rendered again: the host has to repaint the transcript while
    /// this is true.
    pub fn has_live_thinking_indicator(&self) -> bool {
        self.state
            .live_thinking_indicator
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Stop the braille sign's animation.
    ///
    /// The frame counter stops advancing; the sign keeps its last frame.
    pub fn stop_sign_animation(&self) {
        self.state.stop_spinner_ticker();
    }
}

impl AssistantState {
    /// Run the braille sign's frame ticker, if it is not already running.
    ///
    /// The ticker advances the live run's counter once per
    /// [`SPINNER_FRAME_MS`] — the sign's rate is its own, not the rate of the
    /// repaints that happen to occur.
    fn start_spinner_ticker(&self) {
        let mut ticker = match self.spinner_ticker.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if ticker.is_some() {
            return;
        }
        let timings = Arc::clone(&self.thinking_run_timings);
        *ticker = Some(SpinnerTicker::start(
            SPINNER_FRAME_MS,
            move || {
                if let Ok(timings) = timings.lock() {
                    if let Some(timing) = timings.last() {
                        if let Some(counter) = &timing.spinner_counter {
                            counter.advance();
                        }
                    }
                }
            },
        ));
    }

    /// Stop the braille sign's frame ticker.
    fn stop_spinner_ticker(&self) {
        let mut ticker = match self.spinner_ticker.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if let Some(mut running) = ticker.take() {
            running.stop();
        }
    }

    /// Apply the installed transformer to a raw markdown string (identity when
    /// none is installed). Both the text arm and the thinking arm of
    /// `rebuild_content` route through here so a single install point covers
    /// both. Thinking is treated like text — the spec transforms "assistant
    /// markdown text" and thinking is rendered as markdown too; a plugin that
    /// wants to skip thinking can inspect the input it receives (no flag is
    /// carried in the `{"markdown": …}` envelope).
    fn transform_markdown(&self, raw: &str) -> String {
        match self.markdown_transformer.lock().unwrap().clone() {
            Some(f) => f(raw),
            None => raw.to_string(),
        }
    }

    /// Rebuild the content container from a block list (the shared render path).
    ///
    /// Mirrors the TS `updateContent` loop, simplified to the text/thinking
    /// block pair (tool-call / image / error rendering is owned by other
    /// components: tool-exec blocks render via `ToolExecutionComponent`,
    /// and stop-reason error lines surface through `add_error_message` in the
    /// host). Empty content renders nothing.
    fn rebuild_content(self: &Arc<Self>, blocks: &[AssistantBlock]) {
        self.content_container.clear();
        self.live_thinking_indicator
            .store(false, std::sync::atomic::Ordering::Relaxed);

        let opts = self.options.lock().unwrap().clone();
        let has_visible = blocks.iter().any(|b| {
            matches!(b, AssistantBlock::Text(t) if !t.trim().is_empty())
                || matches!(b, AssistantBlock::Thinking(t) if !t.trim().is_empty())
                || matches!(b, AssistantBlock::Image(data) if !data.is_empty())
        });

        if !has_visible {
            // Empty / whitespace-only content renders nothing (matches the TS
            // early return when no visible block is present).
            self.sync_spinner_ticker();
            return;
        }

        // The original puts a blank row in front of the message's own content
        // (packages/coding-agent/src/modes/interactive/components/assistant-message.ts:154-156).
        // The host's spacer sits before each transcript entry, not after it, so
        // the two are not stacked on the same gap.
        self.content_container
            .add_child(Arc::new(crate::spacer::Spacer::new(1)));
        let mut i = 0;
        let mut thinking_run_index = 0usize;
        while i < blocks.len() {
            let block = &blocks[i];
            match block {
                AssistantBlock::Text(t) if !t.trim().is_empty() => {
                    // B5e: apply the installed markdown transformer (identity
                    // when none) BEFORE styling, so a plugin's
                    // `register_markdown_transformer` sees the raw assistant
                    // markdown and `Markdown::render_markdown` styles the
                    // transformed text.
                    let transformed = self.transform_markdown(t.trim());
                    let md = Arc::new(Markdown::new(transformed, opts.output_pad, 0));
                    self.content_container.add_child(md);
                    i += 1;
                }
                AssistantBlock::Text(_) => {
                    // Whitespace-only text block — skip (TS trims + skips empty).
                    i += 1;
                }
                AssistantBlock::Image(data) if !data.is_empty() => {
                    let image = Arc::new(Image::from_data(data.clone(), ImageOptions::default()));
                    image.set_inline_visible(*self.show_images.lock().unwrap());
                    self.content_container.add_child(image);
                    i += 1;
                }
                AssistantBlock::Image(_) => {
                    i += 1;
                }
                AssistantBlock::Thinking(_) => {
                    // Coalesce a run of consecutive thinking blocks into one
                    // section, exactly like the TS inner loop.
                    let mut joined: Vec<String> = Vec::new();
                    while i < blocks.len() {
                        match &blocks[i] {
                            AssistantBlock::Thinking(t) if !t.trim().is_empty() => {
                                joined.push(t.trim().to_string());
                                i += 1;
                            }
                            AssistantBlock::Thinking(_) => {
                                i += 1; // whitespace-only thinking, skip
                            }
                            _ => break,
                        }
                    }
                    if joined.is_empty() {
                        continue;
                    }

                    let body = joined.join("\n\n");
                    let run_index = thinking_run_index;
                    thinking_run_index += 1;
                    self.track_thinking_run(run_index, &body);
                    let hidden = self
                        .thinking_visibility_overrides
                        .lock()
                        .unwrap()
                        .get(&run_index)
                        .copied()
                        .unwrap_or(opts.hide_thinking);

                    // The run's own component: the summary line (plus the
                    // thinking body when the run is shown), wrapped in a
                    // `MouseRegion` so a click toggles the run — the original
                    // wraps the thinking component the same way
                    // (`components/assistant-message.ts:202-210`).
                    let thinking = Arc::new(Container::new());
                    if hidden {
                        if *self.is_streaming.lock().unwrap() {
                            // A live run shows the spinning label instead of
                            // the summary (pi's `ThinkingIndicator`).
                            thinking.add_child(Arc::new(ThinkingIndicator::new(
                                opts.hidden_thinking_label.clone(),
                                opts.output_pad,
                                true,
                                self.thinking_run_counter(run_index),
                            )));
                            self.live_thinking_indicator.store(true, std::sync::atomic::Ordering::Relaxed);
                        } else {
                            thinking.add_child(Arc::new(Text::new(
                                self.thought_summary(run_index, false),
                                opts.output_pad,
                                0,
                            )));
                        }
                    } else {
                        // The expanded run shows the summary line (`- Thought ·
                        // 3.7s`) followed by the thinking itself.
                        thinking.add_child(Arc::new(Text::new(
                            self.thought_summary(run_index, true),
                            opts.output_pad,
                            0,
                        )));
                        // Render the joined thinking as one dim italic markdown
                        // section — the TS `color: thinkingText, italic: true`
                        // styling. The base style must be applied per rendered
                        // line (not by wrapping the whole markdown source with
                        // ANSI): the renderer's inner spans (inline code,
                        // links, headings) emit `SGR 0` resets, which would
                        // otherwise drop the enclosing italic/color from the
                        // rest of the block.
                        // B5e: transform the PLAIN thinking markdown first (the
                        // plugin must see markdown, not ANSI).
                        let transformed = self.transform_markdown(&body);
                        let base_style = format!("\x1b[3m{}", theme().colors.thinking_text.to_fg());
                        let md = Arc::new(
                            Markdown::new(transformed, opts.output_pad, 0)
                                .with_base_style(base_style),
                        );
                        thinking.add_child(md);
                    }
                    let handler_state = Arc::clone(self);
                    let handler: MouseRegionHandler = Arc::new(move |event: &MouseEvent| {
                        if event.kind != MouseEventKind::Click || event.button != MouseButton::Left {
                            return None;
                        }
                        handler_state.toggle_thinking_run(run_index);
                        Some(MouseEventResult::handled())
                    });
                    self.content_container.add_child(Arc::new(MouseRegion::new(
                        thinking,
                        handler,
                    )));

                    // Spacer before a following visible block (TS
                    // `hasVisibleContentAfter` → Spacer(1)).
                    let has_after = blocks[i..].iter().any(|b| {
                        matches!(b, AssistantBlock::Text(t) if !t.trim().is_empty())
                            || matches!(b, AssistantBlock::Thinking(t) if !t.trim().is_empty())
                            || matches!(b, AssistantBlock::Image(data) if !data.is_empty())
                    });
                    if has_after {
                        self.content_container.add_child(Arc::new(Spacer::new(1)));
                    }
                }
            }
        }
        self.sync_spinner_ticker();
    }

    /// Run the sign's ticker while a spinning sign is on screen, and stop it
    /// when the sign is gone.
    fn sync_spinner_ticker(&self) {
        if self.live_thinking_indicator.load(std::sync::atomic::Ordering::Relaxed) {
            self.start_spinner_ticker();
        } else {
            self.stop_spinner_ticker();
        }
    }

    /// Record when a thinking run's content last changed, so the collapsed
    /// summary can show how long the thinking took. The clock starts with the
    /// first chunk and stops with the last one. Only live streams are timed: a
    /// message restored from a session has no run time to show.
    fn track_thinking_run(&self, run_index: usize, text: &str) {
        if !*self.is_streaming.lock().unwrap() {
            return;
        }
        let now = crate::clock::wall_now_ms();
        let mut timings = self.thinking_run_timings.lock().unwrap();
        if timings.len() <= run_index {
            timings.resize(run_index + 1, ThinkingRunTiming::default());
        }
        let timing = &mut timings[run_index];
        if timing.text.as_deref() == Some(text) {
            return;
        }
        timing.text = Some(text.to_string());
        if timing.started_at.is_none() {
            timing.started_at = Some(now);
            timing.spinner_counter = Some(Arc::new(SpinnerCounter::new()));
        }
        timing.ended_at = Some(now);
    }

    /// The frame counter of a thinking run's braille sign.
    ///
    /// The counter is created on demand: a run whose first chunk arrived
    /// before the message was marked as streaming still gets one, so its sign
    /// animates.
    fn thinking_run_counter(&self, run_index: usize) -> Option<Arc<SpinnerCounter>> {
        let mut timings = self.thinking_run_timings.lock().unwrap();
        let timing = timings.get_mut(run_index)?;
        if timing.spinner_counter.is_none() {
            timing.spinner_counter = Some(Arc::new(SpinnerCounter::new()));
        }
        timing.spinner_counter.clone()
    }

    /// The summary line of a thinking run: `+ Thought · 3.7s` while
    /// collapsed, `- Thought · 3.7s` while the block is shown.
    fn thought_summary(&self, run_index: usize, expanded: bool) -> String {
        let timing = self
            .thinking_run_timings
            .lock()
            .unwrap()
            .get(run_index)
            .cloned();
        let duration = timing.and_then(|timing| {
            let started_at = timing.started_at?;
            let ended_at = timing.ended_at.unwrap_or(started_at);
            Some(ended_at - started_at)
        });
        format_thought_summary(expanded, duration)
    }

    /// Toggle one thinking run between the collapsed summary and the expanded
    /// body. Returns the new visibility.
    fn toggle_thinking_run(self: &Arc<Self>, run_index: usize) -> bool {
        let current = {
            let overrides = self.thinking_visibility_overrides.lock().unwrap();
            overrides
                .get(&run_index)
                .copied()
                .unwrap_or_else(|| {
                    self.options
                        .lock()
                        .unwrap()
                        .hide_thinking
                })
        };
        let next = !current;
        self.thinking_visibility_overrides
            .lock()
            .unwrap()
            .insert(run_index, next);
        let blocks = self.last_blocks.lock().unwrap().clone();
        if !blocks.is_empty() {
            self.rebuild_content(&blocks);
        }
        next
    }
}

impl AssistantMessageComponent {
    /// Update with error message.
    pub fn update_error(&self, error: &str, stop_reason: &str) {
        // Clear content container
        self.state.content_container.clear();
        *self.state.last_blocks.lock().unwrap() = Vec::new();

        // Add spacing
        self.state.content_container.add_child(Arc::new(Spacer::new(1)));

        // Add error message
        let error_text = match stop_reason {
            "aborted" => "Operation aborted".to_string(),
            "error" => format!("Error: {}", error),
            "length" => "Response was truncated before completion.".to_string(),
            _ => error.to_string(),
        };

        let error_component = Arc::new(Text::new(error_text, 1, 0));
        self.state.content_container.add_child(error_component);
    }

    /// Set hide thinking option. Rebuilds the last content so the toggle is
    /// reflected immediately (mirrors the TS setter).
    pub fn set_hide_thinking(&self, hide: bool) {
        let blocks = {
            let mut opts = self.state.options.lock().unwrap();
            if opts.hide_thinking == hide {
                return;
            }
            opts.hide_thinking = hide;
            self.state.last_blocks.lock().unwrap().clone()
        };
        self.state.thinking_visibility_overrides.lock().unwrap().clear();
        self.rebuild_content(&blocks);
    }

    pub fn set_show_images(&self, show: bool) {
        *self.state.show_images.lock().unwrap() = show;
        for child in self.state.content_container.get_children() {
            if let Some(image) = child.as_any().downcast_ref::<Image>() {
                image.set_inline_visible(show);
            }
        }
    }

    /// Set hidden thinking label. Rebuilds the last content (mirrors TS).
    pub fn set_hidden_thinking_label(&self, label: &str) {
        let blocks = {
            let mut opts = self.state.options.lock().unwrap();
            opts.hidden_thinking_label = label.to_string();
            self.state.last_blocks.lock().unwrap().clone()
        };
        self.rebuild_content(&blocks);
    }

    /// Set output padding. Rebuilds the last content (mirrors TS).
    pub fn set_output_pad(&self, pad: usize) {
        let blocks = {
            let mut opts = self.state.options.lock().unwrap();
            opts.output_pad = pad;
            self.state.last_blocks.lock().unwrap().clone()
        };
        self.rebuild_content(&blocks);
    }

    /// Check if has tool calls.
    pub fn has_tool_calls(&self) -> bool {
        *self.state.has_tool_calls.lock().unwrap()
    }

    /// The currently installed markdown transformer (B5e), if any. The host
    /// reads this to carry an existing transform into a fresh component (e.g.
    /// after a `/reload`) so the new component renders with the same plugin
    /// transformer without the host re-querying the registry.
    pub fn markdown_transformer(&self) -> Option<Arc<dyn Fn(&str) -> String + Send + Sync>> {
        self.state.markdown_transformer.lock().unwrap().clone()
    }

    /// Add trailing rows only when the message renders visible content.
    pub fn set_trailing_spacing(&self, rows: usize) {
        *self.state.trailing_spacing.lock().unwrap() = rows;
    }

    /// Set streaming state. A finished message rebuilds its content so the
    /// collapsed summary replaces the live thinking indicator.
    pub fn set_streaming(&self, streaming: bool) {
        let changed = {
            let mut current = self.state.is_streaming.lock().unwrap();
            let changed = *current != streaming;
            *current = streaming;
            changed
        };
        if !changed {
            return;
        }
        let blocks = self.state.last_blocks.lock().unwrap().clone();
        if !blocks.is_empty() {
            self.rebuild_content(&blocks);
        }
    }
}

impl Component for AssistantMessageComponent {
    fn set_output_pad(&self, pad: usize) {
        AssistantMessageComponent::set_output_pad(self, pad);
    }

    fn render(&self, width: usize) -> Vec<String> {
        let mut lines = self.state.content_container.render(width);
        // A provider can start with no content or whitespace-only deltas.
        // Such a message must not reserve even its inter-message spacing.
        if !lines.is_empty() {
            lines.extend((0..*self.state.trailing_spacing.lock().unwrap()).map(|_| String::new()));
        }
        lines
    }

    fn invalidate(&self) {
        // Rebuild from the last blocks (mirrors the TS invalidate path that
        // re-runs updateContent on the cached lastMessage).
        let blocks = self.state.last_blocks.lock().unwrap().clone();
        if !blocks.is_empty() {
            self.rebuild_content(&blocks);
        }
        self.state.content_container.invalidate();
    }

    /// Forward the mouse to the content, so the thinking summary's click
    /// reaches the run it belongs to (the original's `MouseRegion` around the
    /// thinking component needs the same route through the message).
    fn handle_mouse(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        self.state.content_container.handle_mouse(event)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ansi::strip_ansi;
    use crate::loader::{spinner_frame_at, spinner_frame_index};

    #[test]
    fn an_assistant_message_starts_with_a_blank_row() {
        use crate::component::Component;
        let message = AssistantMessageComponent::new(AssistantMessageOptions::default());
        message.update_text("hello");
        let lines = message.render(40);
        assert_eq!(lines[0].trim_end(), "", "the leading spacer: {lines:?}");
        assert!(
            lines.iter().any(|line| line.contains("hello")),
            "{lines:?}"
        );
    }

    #[test]
    fn test_assistant_message_basic() {
        let msg = AssistantMessageComponent::default();
        msg.update_text("Hello, world!");

        let lines = msg.render(80);
        assert!(!lines.is_empty());
    }

    #[test]
    fn test_assistant_message_empty() {
        let msg = AssistantMessageComponent::default();
        msg.update_text("");

        let lines = msg.render(80);
        assert!(lines.is_empty() || lines.iter().all(|l| l.trim().is_empty()));
    }

    #[test]
    fn trailing_spacing_does_not_render_for_empty_streaming_content() {
        let msg = AssistantMessageComponent::default();
        msg.set_trailing_spacing(1);
        msg.set_streaming(true);
        for blocks in [
            vec![],
            vec![AssistantBlock::Text(" \n\t".into())],
            vec![AssistantBlock::Thinking(" ".into())],
        ] {
            msg.update_blocks(&blocks);
            assert!(msg.render(80).is_empty());
        }
        msg.update_text("Hello");
        msg.set_trailing_spacing(0);
        let mut expected = msg.render(80);
        expected.push(String::new());
        msg.set_trailing_spacing(1);
        assert_eq!(msg.render(80), expected);
        msg.update_blocks(&[]);
        msg.set_streaming(false);
        assert!(msg.render(80).is_empty());
    }

    #[test]
    fn test_assistant_message_error() {
        let msg = AssistantMessageComponent::default();
        msg.update_error("Something went wrong", "error");

        let lines = msg.render(80);
        assert!(!lines.is_empty());
        assert!(strip_ansi(&lines.join("\n")).contains("Error:"));
    }

    #[test]
    fn test_assistant_message_options() {
        let msg = AssistantMessageComponent::new(AssistantMessageOptions {
            hide_thinking: true,
            hidden_thinking_label: "Processing...".to_string(),
            output_pad: 2,
        });

        msg.update_text("Test");
        let lines = msg.render(80);
        assert!(!lines.is_empty());
    }

    #[test]
    fn test_thinking_and_text_render_in_order() {
        // A thinking block followed by a text block should render BOTH, in
        // order, with a blank separator between them.
        let msg = AssistantMessageComponent::new(AssistantMessageOptions {
            hide_thinking: false,
            ..Default::default()
        });
        msg.update_blocks(&[
            AssistantBlock::Thinking("Let me consider the options.".to_string()),
            AssistantBlock::Text("Here is the answer.".to_string()),
        ]);
        let lines = msg.render(80);
        let joined = strip_ansi(&lines.join("\n"));
        // Ordering: the thinking content appears before the answer text.
        let think_pos = joined.find("consider the options");
        let text_pos = joined.find("Here is the answer");
        assert!(think_pos.is_some(), "thinking not rendered: {joined}");
        assert!(text_pos.is_some(), "text not rendered: {joined}");
        assert!(
            think_pos < text_pos,
            "thinking should precede text: {joined}"
        );
    }

    #[test]
    fn test_thinking_style_survives_inline_code_reset() {
        // Regression: the thinking base style used to be applied by wrapping
        // the whole markdown source with ANSI. Inline code emits an `SGR 0`
        // reset, which dropped the italic + thinking color for the rest of the
        // block. The base style must be re-opened after that reset.
        let msg = AssistantMessageComponent::new(AssistantMessageOptions {
            hide_thinking: false,
            ..Default::default()
        });
        msg.update_blocks(&[AssistantBlock::Thinking(
            "consider `render_inline` then keep thinking".to_string(),
        )]);
        let rendered = msg.render(80).join("\n");
        let fg = theme().colors.thinking_text.to_fg();
        let after_code = rendered
            .split("render_inline")
            .nth(1)
            .expect("inline code not rendered");
        assert!(
            after_code.contains("keep thinking"),
            "text after inline code missing: {rendered:?}"
        );
        assert!(
            after_code.contains("\x1b[3m") && after_code.contains(&fg),
            "thinking italic/color lost after inline code: {rendered:?}"
        );
    }

    #[test]
    fn test_hide_thinking_shows_the_summary_only() {
        let msg = AssistantMessageComponent::new(AssistantMessageOptions {
            hide_thinking: true,
            hidden_thinking_label: "Thinking...".to_string(),
            ..Default::default()
        });
        msg.update_blocks(&[
            AssistantBlock::Thinking("secret reasoning".to_string()),
            AssistantBlock::Text("Public answer.".to_string()),
        ]);
        let joined = strip_ansi(&msg.render(80).join("\n"));
        assert!(joined.contains("+ Thought"), "summary missing: {joined}");
        assert!(
            !joined.contains("secret reasoning"),
            "hidden thinking leaked: {joined}"
        );
        assert!(joined.contains("Public answer."), "text missing: {joined}");
    }

    #[test]
    fn test_consecutive_thinking_blocks_coalesce() {
        // Two adjacent thinking blocks coalesce into one section (no trailing
        // blank between them — the spacer goes between the run and the next
        // visible block, not between thinking blocks).
        let msg = AssistantMessageComponent::new(AssistantMessageOptions {
            hide_thinking: false,
            ..Default::default()
        });
        msg.update_blocks(&[
            AssistantBlock::Thinking("part one".to_string()),
            AssistantBlock::Thinking("part two".to_string()),
            AssistantBlock::Text("Done.".to_string()),
        ]);
        let joined = strip_ansi(&msg.render(80).join("\n"));
        assert!(joined.contains("part one"));
        assert!(joined.contains("part two"));
        assert!(joined.contains("Done."));
    }

    #[test]
    fn test_set_hide_thinking_rebuilds() {
        // Toggling hide_thinking after an update should rebuild the render.
        let msg = AssistantMessageComponent::new(AssistantMessageOptions {
            hide_thinking: false,
            ..Default::default()
        });
        msg.update_blocks(&[
            AssistantBlock::Thinking("internal".to_string()),
            AssistantBlock::Text("visible".to_string()),
        ]);
        let before = strip_ansi(&msg.render(80).join("\n"));
        assert!(before.contains("internal"));
        msg.set_hide_thinking(true);
        let after = strip_ansi(&msg.render(80).join("\n"));
        assert!(
            !after.contains("internal"),
            "not rebuilt after toggle: {after}"
        );
        assert!(after.contains("+ Thought"), "summary missing: {after}");
    }

    #[test]
    fn test_markdown_transformer_applied_to_text_and_thinking() {
        // B5e: an installed transformer rewrites the raw markdown BEFORE styling.
        // A trivial uppercasing transformer proves the text arm + the thinking
        // arm both route through `transform_markdown` (and that the thinking arm
        // transforms the PLAIN body, not the ANSI-wrapped output).
        let msg = AssistantMessageComponent::new(AssistantMessageOptions {
            hide_thinking: false,
            ..Default::default()
        });
        let transformer: Arc<dyn Fn(&str) -> String + Send + Sync> =
            Arc::new(|raw: &str| raw.to_uppercase());
        msg.set_markdown_transformer(Some(transformer));
        msg.update_blocks(&[
            AssistantBlock::Thinking("quiet reasoning".to_string()),
            AssistantBlock::Text("hello world".to_string()),
        ]);
        let joined = strip_ansi(&msg.render(80).join("\n"));
        assert!(
            joined.contains("QUIET REASONING"),
            "thinking not transformed: {joined}"
        );
        assert!(
            joined.contains("HELLO WORLD"),
            "text not transformed: {joined}"
        );
    }

    #[test]
    fn test_markdown_transformer_swap_rebuilds() {
        // B5e: swapping the transformer after an update rebuilds the last blocks
        // so the new transform is reflected immediately (mirrors the option
        // setters). A None clears the transform (identity).
        let msg = AssistantMessageComponent::default();
        msg.update_blocks(&[AssistantBlock::Text("hello".to_string())]);
        let upper: Arc<dyn Fn(&str) -> String + Send + Sync> =
            Arc::new(|raw: &str| raw.to_uppercase());
        msg.set_markdown_transformer(Some(upper));
        assert!(strip_ansi(&msg.render(80).join("\n")).contains("HELLO"));
        // Clear → identity.
        msg.set_markdown_transformer(None);
        assert!(strip_ansi(&msg.render(80).join("\n")).contains("hello"));
    }

    #[test]
    fn test_no_transformer_is_identity() {
        // B5e: with no transformer installed, raw text reaches the renderer
        // unchanged (the default path — every existing test relies on this).
        let msg = AssistantMessageComponent::default();
        msg.update_blocks(&[AssistantBlock::Text("plain text".to_string())]);
        assert!(msg.markdown_transformer().is_none());
        assert!(strip_ansi(&msg.render(80).join("\n")).contains("plain text"));
    }

    #[test]
    fn the_collapsed_thinking_run_shows_the_summary_line() {
        // A finished message (no live stream ⇒ no measured duration) shows
        // the `+ Thought` summary instead of the thinking body.
        let msg = AssistantMessageComponent::default();
        msg.update_blocks(&[AssistantBlock::Thinking("secret reasoning".to_string())]);
        let joined = strip_ansi(&msg.render(80).join("\n"));
        assert!(joined.contains("+ Thought"), "summary missing: {joined}");
        assert!(
            !joined.contains("secret reasoning"),
            "thinking leaked: {joined}"
        );
    }

    #[test]
    fn the_expanded_thinking_run_shows_the_summary_and_the_body() {
        let msg = AssistantMessageComponent::new(AssistantMessageOptions {
            hide_thinking: false,
            ..Default::default()
        });
        msg.update_blocks(&[AssistantBlock::Thinking("secret reasoning".to_string())]);
        let joined = strip_ansi(&msg.render(80).join("\n"));
        assert!(joined.contains("- Thought"), "summary missing: {joined}");
        assert!(joined.contains("secret reasoning"), "body missing: {joined}");
    }

    #[test]
    fn a_live_thinking_run_shows_the_streaming_indicator() {
        let msg = AssistantMessageComponent::default();
        msg.set_streaming(true);
        msg.update_blocks(&[AssistantBlock::Thinking("secret reasoning".to_string())]);
        let joined = strip_ansi(&msg.render(80).join("\n"));
        assert!(
            joined.contains("Thinking..."),
            "streaming indicator missing: {joined}"
        );
        assert!(!joined.contains("+ Thought"), "summary leaked: {joined}");
        // The indicator is a braille spinner in front of the label.
        let spinner = SPINNER_FRAMES
            .iter()
            .any(|frame| joined.contains(*frame));
        assert!(spinner, "spinner missing: {joined}");
    }

    #[test]
    fn the_summary_line_text_is_pinned() {
        assert_eq!(
            strip_ansi(&format_thought_summary(false, Some(3700.0))),
            "+ Thought · 3.7s"
        );
        assert_eq!(
            strip_ansi(&format_thought_summary(true, Some(3700.0))),
            "- Thought · 3.7s"
        );
        assert_eq!(
            strip_ansi(&format_thought_summary(false, None)),
            "+ Thought"
        );
    }

    #[test]
    fn the_duration_format_is_pinned() {
        assert_eq!(format_tool_duration(0.0), "0.0s");
        assert_eq!(format_tool_duration(3_700.0), "3.7s");
        assert_eq!(format_tool_duration(59_900.0), "59.9s");
        assert_eq!(format_tool_duration(65_000.0), "1m 5s");
        assert_eq!(format_tool_duration(3_600_000.0), "1h 0m 0s");
    }

    /// The row of the thinking summary in the rendered message.
    fn summary_row(lines: &[String]) -> usize {
        lines
            .iter()
            .position(|line| strip_ansi(line).contains("+ Thought"))
            .expect("the summary row")
    }

    #[test]
    fn a_click_on_the_thought_summary_expands_the_body() {
        let msg = AssistantMessageComponent::default();
        msg.update_blocks(&[AssistantBlock::Thinking("secret reasoning".to_string())]);
        let lines = msg.render(80);
        let joined = strip_ansi(&lines.join("\n"));
        assert!(joined.contains("+ Thought"), "summary missing: {joined}");
        assert!(
            !joined.contains("secret reasoning"),
            "thinking leaked: {joined}"
        );

        let click = MouseEvent::new(
            MouseEventKind::Click,
            MouseButton::Left,
            0,
            summary_row(&lines),
        );
        let result = msg.handle_mouse(&click).expect("the click is handled");
        assert!(result.handled);

        let after = strip_ansi(&msg.render(80).join("\n"));
        assert!(after.contains("- Thought"), "summary missing: {after}");
        assert!(after.contains("secret reasoning"), "body missing: {after}");
    }

    #[test]
    fn a_click_on_the_expanded_thought_collapses_it_again() {
        let msg = AssistantMessageComponent::default();
        msg.update_blocks(&[AssistantBlock::Thinking("secret reasoning".to_string())]);
        let lines = msg.render(80);
        let row = summary_row(&lines);
        let click = MouseEvent::new(MouseEventKind::Click, MouseButton::Left, 0, row);
        msg.handle_mouse(&click).expect("the click is handled");

        let lines = msg.render(80);
        let expanded = strip_ansi(&lines.join("\n"));
        assert!(expanded.contains("secret reasoning"), "body missing: {expanded}");
        let click = MouseEvent::new(MouseEventKind::Click, MouseButton::Left, 0, row);
        msg.handle_mouse(&click).expect("the click is handled");

        let after = strip_ansi(&msg.render(80).join("\n"));
        assert!(after.contains("+ Thought"), "summary missing: {after}");
        assert!(
            !after.contains("secret reasoning"),
            "thinking leaked: {after}"
        );
    }

    #[test]
    fn a_click_away_from_the_thought_does_not_expand_it() {
        let msg = AssistantMessageComponent::default();
        msg.update_blocks(&[
            AssistantBlock::Thinking("secret reasoning".to_string()),
            AssistantBlock::Text("the answer".to_string()),
        ]);
        let lines = msg.render(80);
        let row = lines
            .iter()
            .position(|line| strip_ansi(line).contains("the answer"))
            .expect("the answer row");
        let click = MouseEvent::new(MouseEventKind::Click, MouseButton::Left, 0, row);
        msg.handle_mouse(&click);
        let after = strip_ansi(&msg.render(80).join("\n"));
        assert!(
            !after.contains("secret reasoning"),
            "thinking leaked: {after}"
        );
    }

    #[test]
    fn toggling_one_thinking_run_expands_only_that_run() {
        let msg = AssistantMessageComponent::default();
        msg.update_blocks(&[
            AssistantBlock::Thinking("first run".to_string()),
            AssistantBlock::Text("between".to_string()),
            AssistantBlock::Thinking("second run".to_string()),
        ]);
        let before = strip_ansi(&msg.render(80).join("\n"));
        assert!(!before.contains("first run"), "run visible: {before}");
        assert!(!before.contains("second run"), "run visible: {before}");

        msg.toggle_thinking_run(0);
        let after = strip_ansi(&msg.render(80).join("\n"));
        assert!(after.contains("first run"), "run not expanded: {after}");
        assert!(!after.contains("second run"), "wrong run expanded: {after}");
        assert!(after.contains("- Thought"), "summary missing: {after}");
    }

    /// The braille frame the message drew.
    fn sign_of(msg: &AssistantMessageComponent) -> char {
        let joined = strip_ansi(&msg.render(80).join("\n"));
        SPINNER_FRAMES
            .iter()
            .find(|frame| joined.contains(**frame))
            .copied()
            .expect("a braille sign")
    }

    /// The frame counter of a run's braille sign.
    fn run_counter(msg: &AssistantMessageComponent) -> Arc<SpinnerCounter> {
        msg.state
            .thinking_run_timings
            .lock()
            .unwrap()
            .get(0)
            .and_then(|timing| timing.spinner_counter.clone())
            .expect("the run's frame counter")
    }

    /// Advance a run's frame counter by `steps` intervals.
    fn advance_run(msg: &AssistantMessageComponent, steps: usize) {
        let counter = run_counter(msg);
        for _ in 0..steps {
            counter.advance();
        }
    }

    #[test]
    fn the_frame_set_and_the_interval_match_the_original() {
        // upstream's `DEFAULT_FRAMES` and `DEFAULT_INTERVAL_MS`.
        assert_eq!(SPINNER_FRAMES.len(), 10);
        assert_eq!(
            SPINNER_FRAMES.iter().collect::<String>(),
            "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
        );
        assert_eq!(SPINNER_FRAME_MS, 80);
    }

    #[test]
    fn the_frame_counter_follows_the_originals_rule() {
        // upstream's `Loader` counts one frame per interval from the moment the
        // indicator starts.
        assert_eq!(spinner_frame_index(std::time::Duration::ZERO), 0);
        assert_eq!(spinner_frame_index(std::time::Duration::from_millis(79)), 0);
        assert_eq!(spinner_frame_index(std::time::Duration::from_millis(80)), 1);
        assert_eq!(spinner_frame_index(std::time::Duration::from_millis(159)), 1);
        assert_eq!(spinner_frame_index(std::time::Duration::from_millis(160)), 2);
        assert_eq!(spinner_frame_index(std::time::Duration::from_millis(800)), 0);
        assert_eq!(spinner_frame_index(std::time::Duration::from_millis(1000)), 2);
        assert_eq!(spinner_frame_at(std::time::Duration::from_millis(1000)), '⠹');
    }

    #[test]
    fn the_sign_does_not_take_its_frame_from_the_wall_clock() {
        let msg = AssistantMessageComponent::default();
        msg.set_streaming(true);
        msg.update_blocks(&[AssistantBlock::Thinking("secret reasoning".to_string())]);

        // The sign's frame is a counter the ticker advances; the test owns it
        // from here on.
        msg.stop_sign_animation();
        let base = run_counter(&msg).index();
        assert_eq!(sign_of(&msg), SPINNER_FRAMES[base]);

        // The wall clock moves on, the frame does not: a clock-driven sign
        // would have walked to another frame by now.
        std::thread::sleep(std::time::Duration::from_millis(120));
        assert_eq!(
            run_counter(&msg).index(),
            base,
            "the wall clock must not move the sign"
        );
        assert_eq!(sign_of(&msg), SPINNER_FRAMES[base]);
    }

    #[test]
    fn the_sign_advances_one_frame_per_interval() {
        let msg = AssistantMessageComponent::default();
        msg.set_streaming(true);
        msg.update_blocks(&[AssistantBlock::Thinking("secret reasoning".to_string())]);
        msg.stop_sign_animation();
        let base = run_counter(&msg).index();

        // One interval per frame, and the frame on screen is the one the
        // original's rule gives for the same elapsed time.
        for k in 0..10usize {
            advance_run(&msg, 1);
            let elapsed = std::time::Duration::from_millis((base + k + 1) as u64 * SPINNER_FRAME_MS);
            assert_eq!(
                sign_of(&msg),
                spinner_frame_at(elapsed),
                "frame {k} must match the original's rule"
            );
        }
    }

    #[test]
    fn the_thinking_clock_keeps_the_originals_rounding_refresh_and_appearance() {
        let msg = AssistantMessageComponent::default();
        msg.set_streaming(true);
        msg.update_blocks(&[AssistantBlock::Thinking("secret reasoning".to_string())]);

        // While the run streams, the row shows the sign — the clock belongs to
        // the summary that replaces it.
        let live = strip_ansi(&msg.render(80).join("\n"));
        assert!(live.contains("Thinking..."), "indicator missing: {live}");
        assert!(!live.contains("Thought"), "summary leaked: {live}");

        // The run's clock runs from the first chunk to the last one.
        {
            let mut timings = msg.state.thinking_run_timings.lock().unwrap();
            timings[0].started_at = Some(1_000.0);
            timings[0].ended_at = Some(4_700.0);
        }
        msg.set_streaming(false);
        let done = strip_ansi(&msg.render(80).join("\n"));
        assert!(
            done.contains("+ Thought · 3.7s"),
            "the clock is missing or rounded differently: {done}"
        );
    }
}
