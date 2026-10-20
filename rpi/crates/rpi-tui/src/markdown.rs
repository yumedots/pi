//! Markdown component for rendering markdown text.
//!
//! Mirrors the TypeScript original (`packages/tui/src/components/markdown.ts`):
//! the same block structure, the same spacing between blocks, the same list
//! markers, the same table layout, the same code fences and the same word
//! wrapping, so a markdown message produces the same pane on both sides.

use std::any::Any;
use std::sync::{LazyLock, Mutex};

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use unicode_segmentation::UnicodeSegmentation;

use super::component::Component;
use super::mermaid::Mermaid;
use crate::ansi::{bold, italic, underline};
use crate::theme::{theme, ThemeColors};
use crate::utils::visible_width;

/// Markdown rendering options.
#[derive(Debug, Clone)]
pub struct MarkdownOptions {
    /// Indentation for code blocks.
    pub code_block_indent: usize,
    /// Maximum width for wrapping (None = use the render width passed in).
    pub max_width: Option<usize>,
    /// Base SGR sequence applied to every rendered line (e.g. the dim italic
    /// style used for thinking blocks). Empty means no base style. The sequence
    /// is re-applied after every nested SGR reset so inner spans (inline code,
    /// links, headings) do not permanently drop the enclosing style.
    pub base_style: String,
    /// Keep the ordered-list markers of the source instead of numbering the
    /// items from the list start.
    pub preserve_ordered_list_markers: bool,
    /// Keep the backslash escapes of the source instead of resolving them.
    pub preserve_backslash_escapes: bool,
    /// Force OSC 8 hyperlinks on or off. `None` detects the support of the
    /// terminal, like the TypeScript original does.
    pub hyperlinks: Option<bool>,
}

impl Default for MarkdownOptions {
    fn default() -> Self {
        Self {
            code_block_indent: 2,
            max_width: None,
            base_style: String::new(),
            preserve_ordered_list_markers: false,
            preserve_backslash_escapes: false,
            hyperlinks: None,
        }
    }
}

/// Markdown - A component that renders markdown text.
pub struct Markdown {
    content: Mutex<String>,
    options: MarkdownOptions,
    padding_x: usize,
    padding_y: usize,
    /// Render cache keyed by (content, width). Markdown parsing + inline
    /// pulldown-cmark work is the dominant per-frame cost of a long transcript;
    /// a finalized message is re-rendered on every frame the transcript is
    /// repainted, so caching the parsed lines is what keeps that O(1) per
    /// unchanged message. Mirrors upstream `Markdown.cachedText/cachedLines`.
    cache: Mutex<Option<MarkdownCache>>,
}

#[derive(Clone)]
struct MarkdownCache {
    content: String,
    width: usize,
    theme_revision: u64,
    lines: Vec<String>,
}

impl Markdown {
    /// Create a new markdown component.
    pub fn new(content: impl Into<String>, padding_x: usize, padding_y: usize) -> Self {
        Self {
            content: Mutex::new(content.into()),
            options: MarkdownOptions::default(),
            padding_x,
            padding_y,
            cache: Mutex::new(None),
        }
    }

    /// Create with options.
    pub fn with_options(
        content: impl Into<String>,
        options: MarkdownOptions,
        padding_x: usize,
        padding_y: usize,
    ) -> Self {
        Self {
            content: Mutex::new(content.into()),
            options,
            padding_x,
            padding_y,
            cache: Mutex::new(None),
        }
    }

    /// Apply a base SGR sequence (for example the dim italic ``\x1b[3m\x1b[38;5;244m``
    /// style) to every rendered line. The base style is re-opened after each
    /// nested full, italic, or foreground reset so inner spans like inline code
    /// or links do not drop it for the remainder of the line.
    pub fn with_base_style(mut self, base_style: impl Into<String>) -> Self {
        self.options.base_style = base_style.into();
        self.clear_cache();
        self
    }

    /// Keep the ordered-list markers of the source.
    pub fn with_preserved_ordered_list_markers(mut self) -> Self {
        self.options.preserve_ordered_list_markers = true;
        self.clear_cache();
        self
    }

    /// Keep the backslash escapes of the source.
    pub fn with_preserved_backslash_escapes(mut self) -> Self {
        self.options.preserve_backslash_escapes = true;
        self.clear_cache();
        self
    }

    /// Wrap one rendered line with the configured base style, re-opening the
    /// base after nested full, italic, or foreground resets. Returns the line
    /// unchanged when no base style is configured.
    fn apply_base_style(&self, line: &str) -> String {
        let base = self.options.base_style.as_str();
        if base.is_empty() {
            return line.to_string();
        }
        let reset = "\x1b[0m";
        let mut out = String::with_capacity(line.len() + base.len() * 4 + reset.len());
        out.push_str(base);
        let mut rest = line;
        while let Some(idx) = rest.find("\x1b[") {
            out.push_str(&rest[..idx]);
            rest = &rest[idx..];
            let Some(end) = rest
                .as_bytes()
                .iter()
                .enumerate()
                .skip(2)
                .find(|(_, byte)| (0x40..=0x7e).contains(*byte))
                .map(|(index, _)| index + 1)
            else {
                break;
            };
            let sequence = &rest[..end];
            out.push_str(sequence);
            if matches!(sequence, "\x1b[0m" | "\x1b[m" | "\x1b[23m" | "\x1b[39m") {
                out.push_str(base);
            }
            rest = &rest[end..];
        }
        out.push_str(rest);
        out.push_str(reset);
        out
    }

    /// Set the content.
    pub fn set_content(&self, content: impl Into<String>) {
        if let Ok(mut c) = self.content.lock() {
            *c = content.into();
        }
        self.clear_cache();
    }

    /// Drop the cached render output.
    fn clear_cache(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            *cache = None;
        }
    }

    /// Get the content.
    pub fn get_content(&self) -> String {
        self.content.lock().map(|c| c.clone()).unwrap_or_default()
    }

    /// The left-pad prefix applied to every rendered line.
    fn pad(&self) -> String {
        " ".repeat(self.padding_x)
    }

    /// Available content width accounting for horizontal padding.
    fn content_width(&self, width: usize) -> usize {
        width.saturating_sub(self.padding_x * 2).max(1)
    }

    /// Render markdown to lines.
    fn render_markdown(&self, width: usize) -> Vec<String> {
        let content = self.content.lock().map(|c| c.clone()).unwrap_or_default();
        if content.trim().is_empty() {
            return Vec::new();
        }
        let pad = self.pad();
        let cwidth = self.content_width(width);

        let mut lines: Vec<String> = Vec::new();
        for _ in 0..self.padding_y {
            lines.push(String::new());
        }

        let source = content.replace('\t', "   ");
        let blocks = parse_blocks(&source, self.options.preserve_backslash_escapes);
        let mut rendered: Vec<String> = Vec::new();
        self.render_blocks(&blocks, &source, cwidth, TextStyle::Default, &mut rendered);

        for line in rendered {
            for wrapped in wrap_text(&line, cwidth) {
                lines.push(format!("{pad}{wrapped}"));
            }
        }

        for _ in 0..self.padding_y {
            lines.push(String::new());
        }

        if lines.is_empty() {
            lines.push(String::new());
        }

        if !self.options.base_style.is_empty() {
            for line in lines.iter_mut() {
                *line = self.apply_base_style(line);
            }
        }

        lines
    }

    /// Render a list of blocks, inserting the blank lines the source had
    /// between them.
    fn render_blocks(
        &self,
        blocks: &[BlockNode],
        source: &str,
        width: usize,
        style: TextStyle,
        out: &mut Vec<String>,
    ) {
        for (index, node) in blocks.iter().enumerate() {
            let next = match blocks.get(index + 1) {
                None => None,
                Some(next_node) => {
                    if blank_line_between(source, node.content_end, next_node.start) {
                        Some(Next::Space)
                    } else {
                        Some(Next::Block(next_node))
                    }
                }
            };
            self.render_block(node, source, width, style, next.as_ref(), out);
            if matches!(next, Some(Next::Space)) {
                out.push(String::new());
            }
        }
    }

    /// Render one block.
    fn render_block(
        &self,
        node: &BlockNode,
        source: &str,
        width: usize,
        style: TextStyle,
        next: Option<&Next>,
        out: &mut Vec<String>,
    ) {
        let colors = theme().colors;
        match &node.block {
            Block::Heading { level, inlines } => {
                let heading_style = TextStyle::Heading(*level);
                let text = self.render_inlines(inlines, heading_style);
                let styled = if *level >= 3 {
                    let prefix = "#".repeat(*level as usize);
                    format!("{} {}", heading_style.apply(&prefix, &colors), text)
                } else {
                    text
                };
                out.push(styled);
                if next.is_some() && !matches!(next, Some(Next::Space)) {
                    out.push(String::new());
                }
            }
            Block::Paragraph { inlines } => {
                out.push(self.render_inlines(inlines, style));
                let followed_by_list = matches!(next, Some(Next::Block(block)) if matches!(block.block, Block::List(_)));
                if next.is_some() && !matches!(next, Some(Next::Space)) && !followed_by_list {
                    out.push(String::new());
                }
            }
            Block::Code { lang, text } => {
                if lang == "mermaid" {
                    let component = Mermaid::new(text.clone());
                    out.extend(component.render(width));
                } else {
                    let indent = " ".repeat(self.options.code_block_indent);
                    out.push(colors.md_code_block_border.fg(&format!("```{lang}")));
                    let mut highlighter = crate::syntax_highlight::Highlighter::new(lang);
                    for line in text.split('\n') {
                        out.push(format!("{indent}{}", highlighter.highlight(line, &colors)));
                    }
                    out.push(colors.md_code_block_border.fg("```"));
                }
                if next.is_some() && !matches!(next, Some(Next::Space)) {
                    out.push(String::new());
                }
            }
            Block::List(list) => {
                self.render_list(list, source, 0, width, style, out);
            }
            Block::Table(table) => {
                self.render_table(table, width, style, out);
                if next.is_some() && !matches!(next, Some(Next::Space)) {
                    out.push(String::new());
                }
            }
            Block::Quote(blocks) => {
                self.render_quote(blocks, source, width, out);
                if next.is_some() && !matches!(next, Some(Next::Space)) {
                    out.push(String::new());
                }
            }
            Block::Rule => {
                out.push(colors.md_hr.fg(&"─".repeat(width.min(80))));
                if next.is_some() && !matches!(next, Some(Next::Space)) {
                    out.push(String::new());
                }
            }
            Block::Html(raw) => {
                out.push(style.apply(raw.trim(), &colors));
            }
            Block::Math(content) => {
                let rendered = render_latex(content);
                for line in rendered.split('\n') {
                    out.push(style.apply(&line, &colors));
                }
                if next.is_some() && !matches!(next, Some(Next::Space)) {
                    out.push(String::new());
                }
            }
        }
    }

    /// Render a list with its markers, task boxes and nested lists.
    fn render_list(
        &self,
        list: &ListBlock,
        source: &str,
        depth: usize,
        width: usize,
        style: TextStyle,
        out: &mut Vec<String>,
    ) {
        let colors = theme().colors;
        let indent = "    ".repeat(depth);
        let loose = list_is_loose(source, list);
        for (index, item) in list.items.iter().enumerate() {
            let is_last = index == list.items.len() - 1;
            let bullet = if self.options.preserve_ordered_list_markers {
                item.marker.clone().unwrap_or_else(|| default_marker(list, index))
            } else {
                default_marker(list, index)
            };
            let task_marker = match item.task {
                Some(true) => "[x] ",
                Some(false) => "[ ] ",
                None => "",
            };
            let marker = format!("{bullet}{task_marker}");
            let first_prefix = format!("{indent}{}", colors.md_list_bullet.fg(&marker));
            let continuation_prefix = format!("{indent}{}", " ".repeat(visible_width(&marker)));
            let item_width = width.saturating_sub(visible_width(&first_prefix)).max(1);
            let mut rendered_any = false;

            for (index, block) in item.blocks.iter().enumerate() {
                if let Block::List(nested) = &block.block {
                    self.render_list(nested, source, depth + 1, width, style, out);
                    rendered_any = true;
                    continue;
                }
                let next = match item.blocks.get(index + 1) {
                    Some(next_block) => {
                        if blank_line_between(source, block.content_end, next_block.start) {
                            Some(Next::Space)
                        } else {
                            None
                        }
                    }
                    None => None,
                };
                let mut block_lines: Vec<String> = Vec::new();
                self.render_block(block, source, item_width, style, next.as_ref(), &mut block_lines);
                if matches!(next, Some(Next::Space)) {
                    block_lines.push(String::new());
                }
                for line in block_lines {
                    for wrapped in wrap_text(&line, item_width) {
                        let prefix = if rendered_any {
                            &continuation_prefix
                        } else {
                            &first_prefix
                        };
                        out.push(format!("{prefix}{wrapped}"));
                        rendered_any = true;
                    }
                }
            }

            if !rendered_any {
                out.push(first_prefix.clone());
            }

            if loose && !is_last {
                out.push(String::new());
            }
        }
    }

    /// Render a block quote: its blocks are rendered at the quote width and
    /// every line gets the quote border.
    fn render_quote(
        &self,
        blocks: &[BlockNode],
        source: &str,
        width: usize,
        out: &mut Vec<String>,
    ) {
        let colors = theme().colors;
        let quote_width = width.saturating_sub(2).max(1);
        let mut rendered: Vec<String> = Vec::new();
        self.render_blocks(blocks, source, quote_width, TextStyle::Quote, &mut rendered);
        while rendered.last().map(|line| line.is_empty()).unwrap_or(false) {
            rendered.pop();
        }
        for line in rendered {
            let styled = colors.md_quote.fg(&italic(&line));
            for wrapped in wrap_text(&styled, quote_width) {
                out.push(format!("{}{}", colors.md_quote_border.fg("│ "), wrapped));
            }
        }
    }

    /// Render a table with wrapped cells and aligned columns.
    fn render_table(
        &self,
        table: &TableBlock,
        available_width: usize,
        style: TextStyle,
        out: &mut Vec<String>,
    ) {
        let num_cols = table.header.len();
        if num_cols == 0 {
            return;
        }

        let border_overhead = 3 * num_cols + 1;
        let available_for_cells = available_width as isize - border_overhead as isize;
        if available_for_cells < num_cols as isize {
            for line in wrap_text(&table.raw, available_width) {
                out.push(line);
            }
            return;
        }
        let available_for_cells = available_for_cells as usize;

        const MAX_UNBROKEN_WORD_WIDTH: usize = 30;

        let mut natural_widths: Vec<usize> = Vec::with_capacity(num_cols);
        let mut min_word_widths: Vec<usize> = Vec::with_capacity(num_cols);
        for index in 0..num_cols {
            let header_text = self.render_inlines(&table.header[index], style);
            natural_widths.push(visible_width(&header_text));
            min_word_widths.push(longest_word_width(&header_text, MAX_UNBROKEN_WORD_WIDTH));
        }
        for row in &table.rows {
            for (index, cell) in row.iter().enumerate() {
                let cell_text = self.render_inlines(cell, style);
                if index >= natural_widths.len() {
                    continue;
                }
                natural_widths[index] = natural_widths[index].max(visible_width(&cell_text));
                min_word_widths[index] = min_word_widths[index]
                    .max(longest_word_width(&cell_text, MAX_UNBROKEN_WORD_WIDTH));
            }
        }

        let mut min_column_widths = min_word_widths.clone();
        let mut min_cells_width: usize = min_column_widths.iter().sum();
        if min_cells_width > available_for_cells {
            min_column_widths = vec![1; num_cols];
            let remaining = available_for_cells.saturating_sub(num_cols);
            if remaining > 0 {
                let total_weight: usize = min_word_widths.iter().map(|w| w.saturating_sub(1)).sum();
                let growth: Vec<usize> = min_word_widths
                    .iter()
                    .map(|w| {
                        let weight = w.saturating_sub(1);
                        if total_weight > 0 {
                            (weight * remaining) / total_weight
                        } else {
                            0
                        }
                    })
                    .collect();
                for (index, value) in growth.iter().enumerate() {
                    min_column_widths[index] += *value;
                }
                let allocated: usize = growth.iter().sum();
                let mut leftover = remaining - allocated;
                let mut index = 0;
                while leftover > 0 && index < num_cols {
                    min_column_widths[index] += 1;
                    leftover -= 1;
                    index += 1;
                }
            }
            min_cells_width = min_column_widths.iter().sum();
        }

        let total_natural_width: usize = natural_widths.iter().sum::<usize>() + border_overhead;
        let column_widths: Vec<usize> = if total_natural_width <= available_width {
            natural_widths
                .iter()
                .enumerate()
                .map(|(index, width)| (*width).max(min_column_widths[index]))
                .collect()
        } else {
            let total_grow_potential: usize = natural_widths
                .iter()
                .enumerate()
                .map(|(index, width)| width.saturating_sub(min_column_widths[index]))
                .sum();
            let extra_width = available_for_cells.saturating_sub(min_cells_width);
            let mut widths: Vec<usize> = min_column_widths
                .iter()
                .enumerate()
                .map(|(index, min_width)| {
                    let delta = natural_widths[index].saturating_sub(*min_width);
                    if total_grow_potential > 0 {
                        min_width + (delta * extra_width) / total_grow_potential
                    } else {
                        *min_width
                    }
                })
                .collect();
            let allocated: usize = widths.iter().sum();
            let mut remaining = available_for_cells.saturating_sub(allocated);
            loop {
                let mut grew = false;
                for index in 0..num_cols {
                    if remaining == 0 {
                        break;
                    }
                    if widths[index] < natural_widths[index] {
                        widths[index] += 1;
                        remaining -= 1;
                        grew = true;
                    }
                }
                if !grew || remaining == 0 {
                    break;
                }
            }
            widths
        };

        let top_cells: Vec<String> = column_widths.iter().map(|w| "─".repeat(*w)).collect();
        out.push(format!("┌─{}─┐", top_cells.join("─┬─")));

        let header_cell_lines: Vec<Vec<String>> = table
            .header
            .iter()
            .enumerate()
            .map(|(index, cell)| {
                let text = self.render_inlines(cell, style);
                wrap_cell_text(&text, column_widths[index])
            })
            .collect();
        let header_line_count = header_cell_lines.iter().map(|c| c.len()).max().unwrap_or(0);
        for line_index in 0..header_line_count {
            let parts: Vec<String> = header_cell_lines
                .iter()
                .enumerate()
                .map(|(index, cell_lines)| {
                    let text = cell_lines.get(line_index).cloned().unwrap_or_default();
                    let padded = format!("{text}{}", " ".repeat(column_widths[index].saturating_sub(visible_width(&text))));
                    bold(&padded)
                })
                .collect();
            out.push(format!("│ {} │", parts.join(" │ ")));
        }

        let separator_cells: Vec<String> = column_widths.iter().map(|w| "─".repeat(*w)).collect();
        let separator = format!("├─{}─┤", separator_cells.join("─┼─"));
        out.push(separator.clone());

        for (row_index, row) in table.rows.iter().enumerate() {
            let row_cell_lines: Vec<Vec<String>> = row
                .iter()
                .enumerate()
                .map(|(index, cell)| {
                    let text = self.render_inlines(cell, style);
                    let width = column_widths.get(index).copied().unwrap_or(1);
                    wrap_cell_text(&text, width)
                })
                .collect();
            let row_line_count = row_cell_lines.iter().map(|c| c.len()).max().unwrap_or(0);
            for line_index in 0..row_line_count {
                let parts: Vec<String> = row_cell_lines
                    .iter()
                    .enumerate()
                    .map(|(index, cell_lines)| {
                        let text = cell_lines.get(line_index).cloned().unwrap_or_default();
                        let width = column_widths.get(index).copied().unwrap_or(0);
                        format!("{text}{}", " ".repeat(width.saturating_sub(visible_width(&text))))
                    })
                    .collect();
                out.push(format!("│ {} │", parts.join(" │ ")));
            }
            if row_index + 1 < table.rows.len() {
                out.push(separator.clone());
            }
        }

        let bottom_cells: Vec<String> = column_widths.iter().map(|w| "─".repeat(*w)).collect();
        out.push(format!("└─{}─┘", bottom_cells.join("─┴─")));
    }

    /// Render inline content.
    fn render_inlines(&self, inlines: &[Inline], style: TextStyle) -> String {
        let colors = theme().colors;
        let mut result = String::new();
        for inline in inlines {
            match inline {
                Inline::Text(text) => result.push_str(&style.apply(text, &colors)),
                Inline::Code(code) => {
                    result.push_str(&colors.md_code.fg(code));
                    result.push_str(&style.prefix(&colors));
                }
                Inline::Strong(children) => {
                    let content = self.render_inlines(children, style);
                    result.push_str(&bold(&content));
                    result.push_str(&style.prefix(&colors));
                }
                Inline::Emphasis(children) => {
                    let content = self.render_inlines(children, style);
                    result.push_str(&italic(&content));
                    result.push_str(&style.prefix(&colors));
                }
                Inline::Strike(children) => {
                    let content = self.render_inlines(children, style);
                    result.push_str(&format!("\x1b[9m{content}\x1b[29m"));
                    result.push_str(&style.prefix(&colors));
                }
                Inline::Link { text, url } => {
                    let link_text = self.render_inlines(text, style);
                    let styled = colors.md_link.fg(&underline(&link_text));
                    if self.options.hyperlinks.unwrap_or_else(hyperlinks_supported) {
                        result.push_str(&crate::ansi::hyperlink(url, &styled));
                    } else {
                        let plain = crate::ansi::strip_ansi(&link_text);
                        let comparable = url.strip_prefix("mailto:").unwrap_or(url);
                        if plain == *url || plain == comparable {
                            result.push_str(&styled);
                        } else {
                            result.push_str(&styled);
                            result.push_str(&colors.md_link_url.fg(&format!(" ({url})")));
                        }
                    }
                    result.push_str(&style.prefix(&colors));
                }
                Inline::Image { text } => {
                    let alt = self.render_inlines(text, style);
                    result.push_str(&crate::ansi::strip_ansi(&alt));
                }
                Inline::Break => result.push('\n'),
                Inline::Html(raw) => result.push_str(&style.apply(raw, &colors)),
                Inline::Math(content) => {
                    result.push_str(&render_latex(content));
                }
                Inline::Footnote(label) => {
                    result.push_str(&style.apply(&format!("[^{label}]"), &colors));
                }
            }
        }
        let prefix = style.prefix(&colors);
        if !prefix.is_empty() {
            while result.ends_with(&prefix) {
                result.truncate(result.len() - prefix.len());
            }
        }
        result
    }
}

/// The kind of block that follows the block being rendered.
enum Next<'a> {
    Space,
    Block(&'a BlockNode),
}

/// The text style applied to a rendered line.
#[derive(Clone, Copy)]
enum TextStyle {
    Default,
    Heading(u8),
    Quote,
}

impl TextStyle {
    fn apply(&self, text: &str, colors: &ThemeColors) -> String {
        match self {
            TextStyle::Default => text.to_string(),
            TextStyle::Heading(1) => colors.md_heading.fg(&bold(&underline(text))),
            TextStyle::Heading(_) => colors.md_heading.fg(&bold(text)),
            TextStyle::Quote => text.to_string(),
        }
    }

    fn prefix(&self, colors: &ThemeColors) -> String {
        match self {
            TextStyle::Default => String::new(),
            TextStyle::Heading(1) => format!("{}\x1b[1m\x1b[4m", colors.md_heading.to_fg()),
            TextStyle::Heading(_) => format!("{}\x1b[1m", colors.md_heading.to_fg()),
            TextStyle::Quote => format!("{}\x1b[3m", colors.md_quote.to_fg()),
        }
    }
}

#[derive(Debug)]
enum Block {
    Heading {
        level: u8,
        inlines: Vec<Inline>,
    },
    Paragraph {
        inlines: Vec<Inline>,
    },
    Code {
        lang: String,
        text: String,
    },
    List(ListBlock),
    Table(TableBlock),
    Quote(Vec<BlockNode>),
    Rule,
    Html(String),
    Math(String),
}

#[derive(Debug)]
struct BlockNode {
    block: Block,
    start: usize,
    content_end: usize,
}

#[derive(Debug)]
struct ListBlock {
    ordered: bool,
    start: u64,
    items: Vec<ListItem>,
    loose: bool,
}

#[derive(Debug)]
struct ListItem {
    blocks: Vec<BlockNode>,
    inlines: Vec<Inline>,
    marker: Option<String>,
    task: Option<bool>,
    start: usize,
}

#[derive(Debug)]
struct TableBlock {
    header: Vec<Vec<Inline>>,
    rows: Vec<Vec<Vec<Inline>>>,
    raw: String,
}

#[derive(Debug)]
enum Inline {
    Text(String),
    Code(String),
    Strong(Vec<Inline>),
    Emphasis(Vec<Inline>),
    Strike(Vec<Inline>),
    Link {
        text: Vec<Inline>,
        url: String,
    },
    Image {
        text: Vec<Inline>,
    },
    Break,
    Html(String),
    Math(String),
    Footnote(String),
}

enum Frame {
    Blocks(Vec<BlockNode>),
    List(ListBlock),
    Item(ListItem),
    Table(TableBlock),
    Row(Vec<Vec<Inline>>),
    Cell(Vec<Inline>),
    Para(Vec<Inline>),
    Code(String, String),
    Heading(u8, Vec<Inline>),
    Span(SpanKind, Vec<Inline>),
}

enum SpanKind {
    Strong,
    Emphasis,
    Strike,
    Link(String),
    Image,
}

/// Parse the markdown source into the block structure the renderer walks.
fn parse_blocks(source: &str, preserve_escapes: bool) -> Vec<BlockNode> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_TASKLISTS);

    let mut stack: Vec<Frame> = vec![Frame::Blocks(Vec::new())];
    let mut starts: Vec<usize> = vec![0];
    let mut ends: Vec<usize> = vec![0];
    let mut skip_until: usize = 0;

    for (event, range) in Parser::new_ext(source, options).into_offset_iter() {
        match event {
            Event::Start(tag) => {
                starts.push(range.start);
                ends.push(range.start);
                match tag {
                    Tag::Paragraph => stack.push(Frame::Para(Vec::new())),
                    Tag::Heading { level, .. } => {
                        stack.push(Frame::Heading(level as u8, Vec::new()))
                    }
                    Tag::CodeBlock(kind) => {
                        let lang = match kind {
                            pulldown_cmark::CodeBlockKind::Fenced(info) => info
                                .split_whitespace()
                                .next()
                                .unwrap_or_default()
                                .to_string(),
                            pulldown_cmark::CodeBlockKind::Indented => String::new(),
                        };
                        stack.push(Frame::Code(lang, String::new()));
                    }
                    Tag::List(start) => stack.push(Frame::List(ListBlock {
                        ordered: start.is_some(),
                        start: start.unwrap_or(1) as u64,
                        items: Vec::new(),
                        loose: false,
                    })),
                    Tag::Item => stack.push(Frame::Item(ListItem {
                        blocks: Vec::new(),
                        inlines: Vec::new(),
                        marker: None,
                        task: None,
                        start: range.start,
                    })),
                    Tag::BlockQuote(_) => stack.push(Frame::Blocks(Vec::new())),
                    Tag::Table(_) => stack.push(Frame::Table(TableBlock {
                        header: Vec::new(),
                        rows: Vec::new(),
                        raw: String::new(),
                    })),
                    Tag::TableHead => stack.push(Frame::Row(Vec::new())),
                    Tag::TableRow => stack.push(Frame::Row(Vec::new())),
                    Tag::TableCell => stack.push(Frame::Cell(Vec::new())),
                    Tag::Emphasis => stack.push(Frame::Span(SpanKind::Emphasis, Vec::new())),
                    Tag::Strong => stack.push(Frame::Span(SpanKind::Strong, Vec::new())),
                    Tag::Strikethrough => stack.push(Frame::Span(SpanKind::Strike, Vec::new())),
                    Tag::Link { dest_url, .. } => {
                        stack.push(Frame::Span(SpanKind::Link(dest_url.into_string()), Vec::new()))
                    }
                    Tag::Image { .. } => stack.push(Frame::Span(SpanKind::Image, Vec::new())),
                    _ => {}
                }
            }
            Event::End(tag) => {
                let start = starts.pop().unwrap_or(0);
                let end = ends.pop().unwrap_or(start);
                if let Some(last) = ends.last_mut() {
                    *last = (*last).max(end);
                }
                match tag {
                    TagEnd::Paragraph => {
                        if let Some(Frame::Para(inlines)) = stack.pop() {
                            let raw = source
                                .get(start..range.end.min(source.len()))
                                .unwrap_or_default();
                            let block = match block_math_content(raw) {
                                Some(content) => Block::Math(content),
                                None => Block::Paragraph { inlines },
                            };
                            let node = BlockNode {
                                block,
                                start,
                                content_end: end,
                            };
                            push_block(&mut stack, node, source);
                        }
                    }
                    TagEnd::Heading(_) => {
                        if let Some(Frame::Heading(level, inlines)) = stack.pop() {
                            let node = BlockNode {
                                block: Block::Heading { level, inlines },
                                start,
                                content_end: end,
                            };
                            push_block(&mut stack, node, source);
                        }
                    }
                    TagEnd::CodeBlock => {
                        if let Some(Frame::Code(lang, text)) = stack.pop() {
                            let text = trim_partial_fence(&text);
                            let text = text.strip_suffix('\n').unwrap_or(&text).to_string();
                            let node = BlockNode {
                                block: Block::Code { lang, text },
                                start,
                                content_end: end,
                            };
                            push_block(&mut stack, node, source);
                        }
                    }
                    TagEnd::List(_) => {
                        if let Some(Frame::List(list)) = stack.pop() {
                            let node = BlockNode {
                                block: Block::List(list),
                                start,
                                content_end: end,
                            };
                            push_block(&mut stack, node, source);
                        }
                    }
                    TagEnd::Item => {
                        if let Some(Frame::Item(mut item)) = stack.pop() {
                            if !item.inlines.is_empty() {
                                let inlines = std::mem::take(&mut item.inlines);
                                item.blocks.insert(
                                    0,
                                    BlockNode {
                                        block: Block::Paragraph { inlines },
                                        start: item.start,
                                        content_end: end,
                                    },
                                );
                            }
                            if let Some(Frame::List(list)) = stack.last_mut() {
                                list.items.push(item);
                            }
                        }
                    }
                    TagEnd::BlockQuote(_) => {
                        if let Some(Frame::Blocks(blocks)) = stack.pop() {
                            let node = BlockNode {
                                block: Block::Quote(blocks),
                                start,
                                content_end: end,
                            };
                            push_block(&mut stack, node, source);
                        }
                    }
                    TagEnd::Table => {
                        if let Some(Frame::Table(mut table)) = stack.pop() {
                            table.raw = source[start..range.end.min(source.len())].to_string();
                            let node = BlockNode {
                                block: Block::Table(table),
                                start,
                                content_end: end,
                            };
                            push_block(&mut stack, node, source);
                        }
                    }
                    TagEnd::TableRow => {
                        if let Some(Frame::Row(cells)) = stack.pop() {
                            if let Some(Frame::Table(table)) = stack.last_mut() {
                                table.rows.push(cells);
                            }
                        }
                    }
                    TagEnd::TableCell => {
                        if let Some(Frame::Cell(inlines)) = stack.pop() {
                            if let Some(Frame::Row(cells)) = stack.last_mut() {
                                cells.push(inlines);
                            }
                        }
                    }
                    TagEnd::TableHead => {
                        if let Some(Frame::Row(cells)) = stack.pop() {
                            if let Some(Frame::Table(table)) = stack.last_mut() {
                                table.header = cells;
                            }
                        }
                    }
                    TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough
                    | TagEnd::Link | TagEnd::Image => {
                        if let Some(Frame::Span(kind, children)) = stack.pop() {
                            let inline = match kind {
                                SpanKind::Strong => Inline::Strong(children),
                                SpanKind::Emphasis => Inline::Emphasis(children),
                                SpanKind::Strike => Inline::Strike(children),
                                SpanKind::Link(url) => Inline::Link {
                                    text: children,
                                    url,
                                },
                                SpanKind::Image => Inline::Image { text: children },
                            };
                            push_inline(&mut stack, inline);
                        }
                    }
                    _ => {}
                }
            }
            Event::Text(text) => {
                let value = text.as_ref();
                let end = range.end;
                let mut skip = skip_until;
                let mut math: Option<Inline> = None;
                if skip == 0 && starts_with_escape(source, range.start) {
                    let first = value.chars().next();
                    if matches!(first, Some('(') | Some('[')) {
                        let closing = if first == Some('(') { "\\)" } else { "\\]" };
                        if let Some(position) = source[end..].find(closing) {
                            let close_start = end + position;
                            let content = source[range.start + 1..close_start].to_string();
                            math = Some(Inline::Math(content));
                            skip = close_start + 2;
                            skip_until = skip;
                        }
                    }
                }
                let mut value = value.to_string();
                if skip > range.start {
                    let drop = (skip - range.start).min(value.len());
                    value = value.chars().skip(drop).collect();
                    if end >= skip {
                        skip_until = 0;
                    }
                }
                let escaped = skip <= range.start && starts_with_escape(source, range.start);
                if let Some(frame) = stack.last_mut() {
                    match frame {
                        Frame::Code(_, buffer) => buffer.push_str(&value),
                        Frame::Para(buffer) | Frame::Cell(buffer) | Frame::Heading(_, buffer) => {
                            if let Some(math) = math {
                                buffer.push(math);
                            }
                            buffer.extend(text_inlines(
                                source,
                                &range,
                                &value,
                                preserve_escapes,
                                escaped,
                            ));
                        }
                        Frame::Span(_, buffer) => {
                            if let Some(math) = math {
                                buffer.push(math);
                            }
                            buffer.extend(text_inlines(
                                source,
                                &range,
                                &value,
                                preserve_escapes,
                                escaped,
                            ));
                        }
                        Frame::Item(item) => {
                            if let Some(math) = math {
                                item.inlines.push(math);
                            }
                            item.inlines.extend(text_inlines(
                                source,
                                &range,
                                &value,
                                preserve_escapes,
                                escaped,
                            ));
                        }
                        _ => {}
                    }
                }
                if let Some(last) = ends.last_mut() {
                    *last = (*last).max(end);
                }
            }
            Event::Code(code) => {
                push_inline(&mut stack, Inline::Code(code.into_string()));
                if let Some(last) = ends.last_mut() {
                    *last = (*last).max(range.end);
                }
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                let value = html.into_string();
                let is_block = matches!(
                    stack.last(),
                    Some(Frame::Blocks(_)) | Some(Frame::Item(_))
                );
                if is_block {
                    let mut content_end = range.end;
                    while content_end > range.start
                        && source[content_end - 1..].starts_with('\n')
                    {
                        content_end -= 1;
                    }
                    let node = BlockNode {
                        block: Block::Html(value),
                        start: range.start,
                        content_end,
                    };
                    push_block(&mut stack, node, source);
                } else {
                    push_inline(&mut stack, Inline::Html(value));
                }
                if let Some(last) = ends.last_mut() {
                    *last = (*last).max(range.end);
                }
            }
            Event::FootnoteReference(label) => {
                push_inline(&mut stack, Inline::Footnote(label.into_string()));
            }
            Event::SoftBreak | Event::HardBreak => {
                push_inline(&mut stack, Inline::Break);
                if let Some(last) = ends.last_mut() {
                    *last = (*last).max(range.end);
                }
            }
            Event::TaskListMarker(checked) => {
                for frame in stack.iter_mut().rev() {
                    if let Frame::Item(item) = frame {
                        item.task = Some(checked);
                        break;
                    }
                }
            }
            Event::Rule => {
                let node = BlockNode {
                    block: Block::Rule,
                    start: range.start,
                    content_end: range.end,
                };
                push_block(&mut stack, node, source);
                if let Some(last) = ends.last_mut() {
                    *last = (*last).max(range.end);
                }
            }
            Event::InlineMath(content) => {
                push_inline(&mut stack, Inline::Math(content.into_string()));
            }
            Event::DisplayMath(content) => {
                push_inline(&mut stack, Inline::Math(content.into_string()));
            }
        }
    }

    let mut blocks = match stack.pop() {
        Some(Frame::Blocks(blocks)) => blocks,
        _ => Vec::new(),
    };
    finalize_blocks(&mut blocks, source);
    blocks
}

/// Split a text chunk into literal text and math spans.
fn text_inlines(
    source: &str,
    range: &std::ops::Range<usize>,
    text: &str,
    preserve_escapes: bool,
    escaped: bool,
) -> Vec<Inline> {
    let raw = source.get(range.clone()).unwrap_or_default();
    let mut value = if preserve_escapes {
        restore_escaped_text(raw, text)
    } else {
        text.to_string()
    };
    if preserve_escapes && escaped {
        let mut chars = value.chars();
        if let Some(first) = chars.next() {
            value = format!("\\{first}{}", chars.as_str());
        }
    }
    if escaped {
        let mut chars = value.chars();
        let first = chars.next().map(|c| c.to_string()).unwrap_or_default();
        let rest: String = chars.collect();
        let mut inlines = vec![Inline::Text(first)];
        inlines.extend(split_math(&rest));
        return inlines;
    }
    if let Some(inlines) = split_bracket_math(raw, &value) {
        return inlines;
    }
    split_math(&value)
}

/// Split a text chunk that holds a `\(...\)` or `\[...\]` math span.
///
/// CommonMark consumes the backslash of the delimiter, so the delimiters are
/// only visible in the source of the chunk.
fn split_bracket_math(raw: &str, value: &str) -> Option<Vec<Inline>> {
    for (opening, closing) in [("\\(", "\\)"), ("\\[", "\\]")] {
        let Some(after) = raw.strip_prefix(opening) else {
            continue;
        };
        let Some(end) = after.find(closing) else {
            return None;
        };
        let content_length = end;
        if value.len() < content_length + 2 {
            return None;
        }
        let content = value[1..1 + content_length].to_string();
        let rest = value[1 + content_length + 1..].to_string();
        let mut inlines = vec![Inline::Math(content)];
        inlines.extend(split_math(&rest));
        return Some(inlines);
    }
    None
}

/// True when the character before the offset is an escaping backslash.
fn starts_with_escape(source: &str, offset: usize) -> bool {
    if offset == 0 {
        return false;
    }
    source[..offset]
        .chars()
        .rev()
        .take_while(|c| *c == '\\')
        .count()
        % 2
        == 1
}

/// Put the backslashes of the source back into the text.
fn restore_escaped_text(raw: &str, text: &str) -> String {
    let mut out = String::new();
    let mut raw_chars = raw.chars().peekable();
    let mut text_chars = text.chars().peekable();
    while let Some(raw_char) = raw_chars.next() {
        let text_char = text_chars.next();
        if raw_char == '\\' {
            if let Some(next_raw) = raw_chars.peek().copied() {
                if next_raw.is_ascii_punctuation() && text_char == Some(next_raw) {
                    out.push('\\');
                    out.push(next_raw);
                    raw_chars.next();
                    text_chars.next();
                    continue;
                }
            }
        }
        match text_char {
            Some(value) => out.push(value),
            None => break,
        }
    }
    for value in text_chars {
        out.push(value);
    }
    out
}

/// Split text into literal text and math spans.
fn split_math(text: &str) -> Vec<Inline> {
    let mut result: Vec<Inline> = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        let candidates = [rest.find('$'), rest.find("\\("), rest.find("\\[")]
            .into_iter()
            .flatten()
            .min();
        let Some(position) = candidates else {
            result.push(Inline::Text(rest.to_string()));
            break;
        };
        if position > 0 {
            result.push(Inline::Text(rest[..position].to_string()));
        }
        let source = &rest[position..];
        match tokenize_inline_latex(source) {
            Some((length, content, pending)) => {
                if pending {
                    result.push(Inline::Text(source.to_string()));
                    break;
                }
                result.push(Inline::Math(content));
                rest = &source[length..];
            }
            None => {
                let mut chars = source.chars();
                let first = chars.next().map(|value| value.to_string()).unwrap_or_default();
                result.push(Inline::Text(first));
                rest = chars.as_str();
            }
        }
    }
    result
}

/// Find an inline math span, mirroring the TypeScript tokenizer.
fn tokenize_inline_latex(source: &str) -> Option<(usize, String, bool)> {
    let (opening, closing) = if source.starts_with("$$") {
        ("$$", "$$")
    } else if source.starts_with("\\(") {
        ("\\(", "\\)")
    } else if source.starts_with("\\[") {
        ("\\[", "\\]")
    } else if source.starts_with('$') && !source[1..].starts_with(char::is_whitespace) {
        ("$", "$")
    } else {
        return None;
    };

    let closing_index = find_closing_delimiter(source, closing, opening.len());
    if let Some(closing_index) = closing_index {
        if opening == "$" {
        let content = &source[opening.len()..closing_index];
        let after = &source[closing_index + 1..];
        if content.ends_with(char::is_whitespace)
            || after.starts_with(|c: char| c.is_ascii_digit())
            || (is_screaming_identifier(content) && starts_with_identifier(after))
                || content.contains('`')
            {
                return None;
            }
        }
    }

    let Some(closing_index) = closing_index else {
        let pending_source = &source[opening.len()..];
        if opening.starts_with('\\') || looks_like_pending_math(pending_source) {
            return Some((source.len(), pending_source.to_string(), true));
        }
        return None;
    };

    let content = &source[opening.len()..closing_index];
    if content.is_empty() || content.contains('\n') {
        return None;
    }
    Some((closing_index + closing.len(), content.to_string(), false))
}

/// Find the closing delimiter, skipping escaped ones.
fn find_closing_delimiter(source: &str, closing: &str, start: usize) -> Option<usize> {
    let mut index = start;
    while let Some(found) = source[index..].find(closing) {
        let position = index + found;
        if !is_escaped(source, position) {
            return Some(position);
        }
        index = position + closing.len();
    }
    None
}

/// True when the delimiter at the offset is preceded by an odd number of
/// backslashes.
fn is_escaped(source: &str, offset: usize) -> bool {
    source[..offset]
        .chars()
        .rev()
        .take_while(|c| *c == '\\')
        .count()
        % 2
        == 1
}

/// True when the text looks like an identifier in screaming case.
fn is_screaming_identifier(text: &str) -> bool {
    let mut chars = text.chars();
    match chars.next() {
        Some('A'..='Z') | Some('_') => {}
        _ => return false,
    }
    for value in chars.by_ref() {
        if value.is_ascii_uppercase() || value.is_ascii_digit() || value == '_' {
            continue;
        }
        let rest: String = chars.collect();
        return rest.is_empty()
            || (rest.chars().count() == 1
                && !rest.chars().next().unwrap().is_ascii_alphanumeric()
                && rest.chars().next().unwrap() != '_'
                && !rest.chars().next().unwrap().is_whitespace());
    }
    true
}

/// True when the text starts with an identifier.
fn starts_with_identifier(text: &str) -> bool {
    let mut chars = text.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// True when the text looks like an unfinished math expression.
fn looks_like_pending_math(text: &str) -> bool {
    if text.contains('\\') {
        let mut chars = text.chars().peekable();
        while let Some(value) = chars.next() {
            if value == '\\' {
                if let Some(next) = chars.peek() {
                    if next.is_ascii_alphabetic() {
                        return true;
                    }
                }
            }
        }
    }
    text.chars().any(|c| {
        "_^=+*/<>()[]|±≤≥≠≈∈→⇒∞∫∑√-".contains(c)
    })
}

/// The content of a block math expression, when the paragraph holds one.
fn block_math_content(raw: &str) -> Option<String> {
    let spaces = raw.chars().take_while(|c| *c == ' ').count();
    if spaces > 3 {
        return None;
    }
    let rest = &raw[spaces..];
    for (opening, closing) in [("$$", "$$"), ("\\[", "\\]")] {
        let Some(after) = rest.strip_prefix(opening) else {
            continue;
        };
        let after = after.trim_start_matches([' ', '\t']);
        let after = after.strip_prefix('\n').unwrap_or(after);
        let Some(end) = after.find(closing) else {
            return None;
        };
        let content = after[..end].trim();
        if content.is_empty() {
            return None;
        }
        let tail = after[end + closing.len()..].trim_start_matches([' ', '\t']);
        if tail.is_empty() || tail.starts_with('\n') {
            return Some(content.to_string());
        }
        return None;
    }
    None
}

/// Attach the source marker of every list item and detect loose lists.
fn finalize_blocks(blocks: &mut Vec<BlockNode>, source: &str) {
    for node in blocks.iter_mut() {
        match &mut node.block {
            Block::List(list) => {
                for item in list.items.iter_mut() {
                    item.marker = source_marker(source, item.start);
                    finalize_blocks(&mut item.blocks, source);
                }
                list.loose = list_is_loose(source, list);
            }
            Block::Quote(inner) => finalize_blocks(inner, source),
            _ => {}
        }
    }
}

/// Push a finished block into the enclosing block or list item.
fn push_block(stack: &mut [Frame], node: BlockNode, source: &str) {
    let _ = source;
    for frame in stack.iter_mut().rev() {
        match frame {
            Frame::Blocks(blocks) => {
                blocks.push(node);
                return;
            }
            Frame::Item(item) => {
                item.blocks.push(node);
                return;
            }
            _ => {}
        }
    }
}

/// Push an inline node into the enclosing inline frame.
fn push_inline(stack: &mut [Frame], inline: Inline) {
    for frame in stack.iter_mut().rev() {
        match frame {
            Frame::Para(buffer) | Frame::Cell(buffer) | Frame::Heading(_, buffer) => {
                buffer.push(inline);
                return;
            }
            Frame::Span(_, buffer) => {
                buffer.push(inline);
                return;
            }
            Frame::Item(item) => {
                item.inlines.push(inline);
                return;
            }
            _ => {}
        }
    }
}

/// True when the source has a blank line between the two offsets.
fn blank_line_between(source: &str, previous_end: usize, next_start: usize) -> bool {
    if previous_end >= next_start {
        return false;
    }
    source[previous_end..next_start].matches('\n').count() >= 2
}

/// The list marker of an item, taken from the source.
fn source_marker(source: &str, item_start: usize) -> Option<String> {
    let rest = source.get(item_start..)?;
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 && digits <= 9 {
        let after_digits = &rest[digits..];
        if let Some(delim) = after_digits.chars().next() {
            if delim == '.' || delim == ')' {
                let after_delim = &after_digits[delim.len_utf8()..];
                if after_delim.starts_with([' ', '\t']) {
                    return Some(format!("{}{delim} ", &rest[..digits]));
                }
            }
        }
    }
    let first = rest.chars().next()?;
    if matches!(first, '-' | '+' | '*') {
        let after = &rest[first.len_utf8()..];
        if after.starts_with([' ', '\t']) || after.is_empty() || after.starts_with('\n') {
            return Some(format!("{first} "));
        }
    }
    None
}

/// The marker a list item gets when the source markers are not preserved.
fn default_marker(list: &ListBlock, index: usize) -> String {
    if list.ordered {
        format!("{}. ", list.start + index as u64)
    } else {
        "- ".to_string()
    }
}

/// True when the list items are separated by blank lines.
fn list_is_loose(source: &str, list: &ListBlock) -> bool {
    for (index, item) in list.items.iter().enumerate() {
        if index + 1 < list.items.len() {
            let previous = item.blocks.last().map(|block| block.content_end).unwrap_or(item.start);
            let next = list.items[index + 1].start;
            if blank_line_between(source, previous, next) {
                return true;
            }
        }
        for (block_index, block) in item.blocks.iter().enumerate() {
            if block_index + 1 < item.blocks.len() {
                let next = item.blocks[block_index + 1].start;
                if blank_line_between(source, block.content_end, next) {
                    return true;
                }
            }
        }
    }
    false
}

/// Remove a streamed partial closing fence from a code block.
fn trim_partial_fence(text: &str) -> String {
    let last_line = text.rsplit('\n').next().unwrap_or("");
    let trimmed = last_line.trim_end();
    if trimmed.is_empty() || trimmed.len() > 2 {
        return text.to_string();
    }
    if !trimmed.chars().all(|c| c == '`' || c == '~') {
        return text.to_string();
    }
    let without = text.strip_suffix(last_line).unwrap_or(text);
    without.strip_suffix('\n').unwrap_or(without).to_string()
}

/// Render a LaTeX expression as Unicode text.
fn render_latex(content: &str) -> String {
    crate::latex::render_latex(content, &crate::latex::RenderLatexOptions::default())
}

/// The visible width of the longest word in a string, capped at `max_width`.
fn longest_word_width(text: &str, max_width: usize) -> usize {
    let mut longest = 0;
    for word in text.split_whitespace() {
        longest = longest.max(visible_width(word));
    }
    longest.min(max_width).max(1)
}

/// Wrap a table cell to the column width.
fn wrap_cell_text(text: &str, max_width: usize) -> Vec<String> {
    let lines = wrap_text(text, max_width.max(1));
    let count = lines.len();
    lines
        .into_iter()
        .enumerate()
        .map(|(index, line)| {
            if index + 1 < count {
                format!("{line}\x1b[22;23;24;25;27;28;29;39m")
            } else {
                line
            }
        })
        .collect()
}

/// Wrap text to the given width, breaking at word boundaries.
fn wrap_text(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![String::new()];
    }
    let mut tracker = AnsiState::default();
    let mut result: Vec<String> = Vec::new();
    for line in text.split('\n') {
        let prefix = if result.is_empty() {
            String::new()
        } else {
            tracker.active_codes()
        };
        result.extend(wrap_line(&format!("{prefix}{line}"), width));
        tracker.process_text(line);
    }
    if result.is_empty() {
        result.push(String::new());
    }
    result
}

/// Wrap a single line at word boundaries.
fn wrap_line(line: &str, width: usize) -> Vec<String> {
    let mut tracker = AnsiState::default();
    if line.is_empty() {
        return vec![String::new()];
    }
    if visible_width(line) <= width {
        return vec![line.to_string()];
    }
    let tokens = split_tokens(line);
    let mut wrapped: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut current_width = 0usize;
    for token in tokens {
        let token_width = visible_width(&token);
        let is_space = token.trim().is_empty();
        if token_width > width && !is_space {
            if !current.is_empty() {
                let reset = tracker.line_end_reset();
                if !reset.is_empty() {
                    current.push_str(&reset);
                }
                wrapped.push(current);
                current = String::new();
                current_width = 0;
            }
            let parts = break_long_token(&token, width, &mut tracker);
            let count = parts.len();
            for (index, part) in parts.into_iter().enumerate() {
                if index + 1 == count {
                    current = part;
                    current_width = visible_width(&current);
                } else {
                    wrapped.push(part);
                }
            }
            continue;
        }
        if current_width + token_width > width && current_width > 0 {
            let mut line_to_wrap = current.trim_end().to_string();
            let reset = tracker.line_end_reset();
            if !reset.is_empty() {
                line_to_wrap.push_str(&reset);
            }
            wrapped.push(line_to_wrap);
            if is_space {
                current = tracker.active_codes();
                current_width = 0;
            } else {
                current = format!("{}{}", tracker.active_codes(), token);
                current_width = token_width;
            }
        } else {
            current.push_str(&token);
            current_width += token_width;
        }
        tracker.process_text(&token);
    }
    if !current.is_empty() {
        wrapped.push(current);
    }
    for line in wrapped.iter_mut() {
        *line = line.trim_end().to_string();
    }
    if wrapped.is_empty() {
        wrapped.push(String::new());
    }
    wrapped
}

/// Split a line into word and whitespace tokens, keeping ANSI codes attached
/// to the token they style.
fn split_tokens(line: &str) -> Vec<String> {
    let bytes = line.as_bytes();
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut pending = String::new();
    let mut kind: Option<bool> = None;
    let mut index = 0usize;
    while index < bytes.len() {
        let escape = escape_length(bytes, index);
        if escape > 0 {
            pending.push_str(&line[index..index + escape]);
            index += escape;
            continue;
        }
        let ch = line[index..].chars().next().unwrap_or(' ');
        let is_space = ch == ' ';
        if kind != Some(is_space) && kind.is_some() {
            tokens.push(std::mem::take(&mut current));
        }
        kind = Some(is_space);
        current.push_str(&pending);
        pending.clear();
        current.push(ch);
        index += ch.len_utf8();
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// The ANSI state of a rendered line.
///
/// The wrapper re-opens the active styles on every continuation row, so a
/// style that spans a wrap boundary survives it.
#[derive(Default)]
struct AnsiState {
    bold: bool,
    dim: bool,
    italic: bool,
    underline: bool,
    blink: bool,
    inverse: bool,
    hidden: bool,
    strikethrough: bool,
    fg: Option<String>,
    bg: Option<String>,
    hyperlink: Option<String>,
}

impl AnsiState {
    fn reset(&mut self) {
        self.bold = false;
        self.dim = false;
        self.italic = false;
        self.underline = false;
        self.blink = false;
        self.inverse = false;
        self.hidden = false;
        self.strikethrough = false;
        self.fg = None;
        self.bg = None;
    }

    fn process(&mut self, code: &str) {
        if let Some(link) = parse_osc8(code) {
            self.hyperlink = link;
            return;
        }
        let Some(params) = code.strip_prefix("\x1b[").and_then(|rest| rest.strip_suffix('m')) else {
            return;
        };
        if params.is_empty() || params == "0" {
            self.reset();
            return;
        }
        let parts: Vec<&str> = params.split(';').collect();
        let mut index = 0usize;
        while index < parts.len() {
            let number: u32 = parts[index].parse().unwrap_or(0);
            if number == 38 || number == 48 {
                if parts.get(index + 1) == Some(&"5") && parts.get(index + 2).is_some() {
                    let color = format!("{};5;{}", parts[index], parts[index + 2]);
                    if number == 38 {
                        self.fg = Some(color);
                    } else {
                        self.bg = Some(color);
                    }
                    index += 3;
                    continue;
                }
                if parts.get(index + 1) == Some(&"2") && parts.get(index + 4).is_some() {
                    let color = format!(
                        "{};2;{};{};{}",
                        parts[index], parts[index + 2], parts[index + 3], parts[index + 4]
                    );
                    if number == 38 {
                        self.fg = Some(color);
                    } else {
                        self.bg = Some(color);
                    }
                    index += 5;
                    continue;
                }
            }
            match number {
                0 => self.reset(),
                1 => self.bold = true,
                2 => self.dim = true,
                3 => self.italic = true,
                4 => self.underline = true,
                5 => self.blink = true,
                7 => self.inverse = true,
                8 => self.hidden = true,
                9 => self.strikethrough = true,
                21 => self.bold = false,
                22 => {
                    self.bold = false;
                    self.dim = false;
                }
                23 => self.italic = false,
                24 => self.underline = false,
                25 => self.blink = false,
                27 => self.inverse = false,
                28 => self.hidden = false,
                29 => self.strikethrough = false,
                39 => self.fg = None,
                49 => self.bg = None,
                _ => {
                    if (30..=37).contains(&number) || (90..=97).contains(&number) {
                        self.fg = Some(number.to_string());
                    } else if (40..=47).contains(&number) || (100..=107).contains(&number) {
                        self.bg = Some(number.to_string());
                    }
                }
            }
            index += 1;
        }
    }

    fn process_text(&mut self, text: &str) {
        let bytes = text.as_bytes();
        let mut index = 0usize;
        while index < bytes.len() {
            if bytes[index] == 0x1b {
                let length = escape_length(bytes, index);
                if length > 0 {
                    self.process(&text[index..index + length]);
                    index += length;
                    continue;
                }
            }
            index += 1;
        }
    }

    fn active_codes(&self) -> String {
        let mut codes: Vec<&str> = Vec::new();
        if self.bold {
            codes.push("1");
        }
        if self.dim {
            codes.push("2");
        }
        if self.italic {
            codes.push("3");
        }
        if self.underline {
            codes.push("4");
        }
        if self.blink {
            codes.push("5");
        }
        if self.inverse {
            codes.push("7");
        }
        if self.hidden {
            codes.push("8");
        }
        if self.strikethrough {
            codes.push("9");
        }
        let mut result = if codes.is_empty() {
            String::new()
        } else {
            format!("\x1b[{}m", codes.join(";"))
        };
        if let Some(url) = &self.hyperlink {
            result.push_str(&format!("\x1b]8;;{url}\x1b\\"));
        }
        result
    }

    fn line_end_reset(&self) -> String {
        let mut result = String::new();
        if self.underline {
            result.push_str("\x1b[24m");
        }
        if self.hyperlink.is_some() {
            result.push_str("\x1b]8;;\x1b\\");
        }
        result
    }
}

/// The URL of an OSC 8 hyperlink sequence, `None` for a closing sequence.
fn parse_osc8(code: &str) -> Option<Option<String>> {
    let rest = code.strip_prefix("\x1b]8;;")?;
    let end = rest.find(['\x07', '\x1b']).unwrap_or(rest.len());
    let url = &rest[..end];
    Some(if url.is_empty() {
        None
    } else {
        Some(url.to_string())
    })
}

/// The length of the escape sequence at the given byte offset.
fn escape_length(bytes: &[u8], index: usize) -> usize {
    if bytes.get(index) != Some(&0x1b) {
        return 0;
    }
    match bytes.get(index + 1) {
        Some(b'[') => {
            let mut cursor = index + 2;
            while cursor < bytes.len() {
                let byte = bytes[cursor];
                if (0x40..=0x7e).contains(&byte) {
                    return cursor - index + 1;
                }
                cursor += 1;
            }
            bytes.len() - index
        }
        Some(b']') => {
            let mut cursor = index + 2;
            while cursor < bytes.len() {
                if bytes[cursor] == 0x07 {
                    return cursor - index + 1;
                }
                if bytes[cursor] == 0x1b && bytes.get(cursor + 1) == Some(&b'\\') {
                    return cursor - index + 2;
                }
                cursor += 1;
            }
            bytes.len() - index
        }
        _ => 0,
    }
}

/// Break a token that is longer than the line width.
fn break_long_token(token: &str, width: usize, tracker: &mut AnsiState) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut current = tracker.active_codes();
    let mut current_width = 0usize;
    let bytes = token.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        let escape = escape_length(bytes, index);
        if escape > 0 {
            current.push_str(&token[index..index + escape]);
            index += escape;
            continue;
        }
        let grapheme = token[index..]
            .graphemes(true)
            .next()
            .unwrap_or_default()
            .to_string();
        index += grapheme.len();
        let grapheme_width = visible_width(&grapheme);
        if current_width + grapheme_width > width && !current.is_empty() {
            let reset = tracker.line_end_reset();
            if !reset.is_empty() {
                current.push_str(&reset);
            }
            parts.push(std::mem::take(&mut current));
            current = tracker.active_codes();
            current_width = 0;
        }
        current.push_str(&grapheme);
        current_width += grapheme_width;
    }
    if !current.is_empty() {
        parts.push(current);
    }
    if parts.is_empty() {
        parts.push(String::new());
    }
    parts
}

/// True when the terminal supports OSC 8 hyperlinks.
fn hyperlinks_supported() -> bool {
    static SUPPORTED: LazyLock<bool> = LazyLock::new(detect_hyperlinks);
    *SUPPORTED
}

/// Detect hyperlink support the way the TypeScript original does.
fn detect_hyperlinks() -> bool {
    match std::env::var("PI_HYPERLINKS").ok().as_deref() {
        Some("1") => return true,
        Some("0") => return false,
        _ => {}
    }
    let term = std::env::var("TERM").unwrap_or_default().to_lowercase();
    let term_program = std::env::var("TERM_PROGRAM")
        .unwrap_or_default()
        .to_lowercase();
    let terminal_emulator = std::env::var("TERMINAL_EMULATOR")
        .unwrap_or_default()
        .to_lowercase();
    if std::env::var("TMUX").is_ok() || term.starts_with("tmux") {
        return probe_tmux_hyperlinks();
    }
    if term.starts_with("screen") {
        return false;
    }
    if term_program == "herdr" {
        return true;
    }
    if std::env::var("KITTY_WINDOW_ID").is_ok() || term_program == "kitty" {
        return true;
    }
    if term_program == "ghostty" || term.contains("ghostty") {
        return true;
    }
    if std::env::var("WEZTERM_PANE").is_ok() || term_program == "wezterm" {
        return true;
    }
    if term_program == "warpterminal"
        || std::env::var("WARP_SESSION_ID").is_ok()
        || std::env::var("WARP_TERMINAL_SESSION_UUID").is_ok()
    {
        return true;
    }
    if std::env::var("ITERM_SESSION_ID").is_ok() || term_program == "iterm.app" {
        return true;
    }
    if std::env::var("WT_SESSION").is_ok() {
        return true;
    }
    if matches!(
        term_program.as_str(),
        "alacritty" | "vscode" | "zed"
    ) {
        return true;
    }
    if terminal_emulator == "jetbrainsjediterm" {
        return false;
    }
    false
}

/// Ask tmux whether the client forwards OSC 8 hyperlinks.
fn probe_tmux_hyperlinks() -> bool {
    let output = std::process::Command::new("tmux")
        .args(["display-message", "-p", "#{client_termfeatures}"])
        .output();
    match output {
        Ok(output) => String::from_utf8_lossy(&output.stdout)
            .split(',')
            .map(|feature| feature.trim())
            .any(|feature| feature == "hyperlinks"),
        Err(_) => false,
    }
}

impl Component for Markdown {
    fn render(&self, width: usize) -> Vec<String> {
        let content = self.content.lock().map(|c| c.clone()).unwrap_or_default();
        let theme_revision = crate::theme::theme_revision();

        if let Ok(cache) = self.cache.lock() {
            if let Some(cached) = cache.as_ref() {
                if cached.width == width
                    && cached.content == content
                    && cached.theme_revision == theme_revision
                {
                    return cached.lines.clone();
                }
            }
        }

        let lines = self.render_markdown(width);
        if let Ok(mut cache) = self.cache.lock() {
            *cache = Some(MarkdownCache {
                content,
                width,
                theme_revision,
                lines: lines.clone(),
            });
        }
        lines
    }

    fn invalidate(&self) {
        self.clear_cache();
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain(markdown: &Markdown) -> Vec<String> {
        markdown
            .render(80)
            .iter()
            .map(|line| crate::ansi::strip_ansi(line))
            .collect()
    }

    fn plain_text(source: &str) -> Vec<String> {
        plain(&Markdown::new(source, 0, 0))
    }

    fn plain_with(source: &str, options: MarkdownOptions) -> Vec<String> {
        plain(&Markdown::with_options(source, options, 0, 0))
    }

    #[test]
    fn headings_hide_the_marker_below_level_three() {
        assert_eq!(
            plain_text("# Title\n\n## Second\n\n### Third"),
            vec!["Title", "", "Second", "", "### Third"]
        );
    }

    #[test]
    fn unordered_list_uses_a_dash_marker() {
        assert_eq!(plain_text("- one\n- two"), vec!["- one", "- two"]);
    }

    #[test]
    fn ordered_list_is_numbered_from_the_start() {
        assert_eq!(plain_text("1. one\n2. two"), vec!["1. one", "2. two"]);
        assert_eq!(plain_text("3. three\n4. four"), vec!["3. three", "4. four"]);
    }

    #[test]
    fn ordered_list_can_keep_the_source_markers() {
        let options = MarkdownOptions {
            preserve_ordered_list_markers: true,
            ..MarkdownOptions::default()
        };
        assert_eq!(
            plain_with("1) one\n2) two", options),
            vec!["1) one", "2) two"]
        );
    }

    #[test]
    fn nested_lists_are_indented_by_four_columns() {
        assert_eq!(
            plain_text("- one\n  - nested\n    - deeper"),
            vec!["- one", "    - nested", "        - deeper"]
        );
    }

    #[test]
    fn task_list_keeps_the_checkbox() {
        assert_eq!(
            plain_text("- [x] done\n- [ ] todo"),
            vec!["- [x] done", "- [ ] todo"]
        );
    }

    #[test]
    fn table_renders_a_box_with_aligned_columns() {
        assert_eq!(
            plain_text("| a | b |\n|---|---|\n| 1 | 2 |"),
            vec![
                "┌───┬───┐",
                "│ a │ b │",
                "├───┼───┤",
                "│ 1 │ 2 │",
                "└───┴───┘",
            ]
        );
    }

    #[test]
    fn code_fence_shows_the_language_on_the_border() {
        assert_eq!(
            plain_text("```rust\nfn main() {}\n```"),
            vec!["```rust", "  fn main() {}", "```"]
        );
    }

    #[test]
    fn link_shows_the_url_when_the_terminal_has_no_hyperlinks() {
        let options = MarkdownOptions {
            hyperlinks: Some(false),
            ..MarkdownOptions::default()
        };
        assert_eq!(
            plain_with("[text](https://example.com)", options),
            vec!["text (https://example.com)"]
        );
    }

    #[test]
    fn link_becomes_a_hyperlink_when_the_terminal_supports_it() {
        let options = MarkdownOptions {
            hyperlinks: Some(true),
            ..MarkdownOptions::default()
        };
        let rendered = Markdown::with_options("[text](https://example.com)", options, 0, 0)
            .render(80)
            .join("\n");
        assert!(rendered.contains("\x1b]8;;https://example.com"), "{rendered:?}");
        assert_eq!(crate::ansi::strip_ansi(&rendered), "text");
    }

    #[test]
    fn inline_math_is_rendered_as_unicode() {
        assert_eq!(plain_text("Inline $x^2$ here."), vec!["Inline x² here."]);
    }

    #[test]
    fn block_math_is_rendered_as_unicode() {
        assert_eq!(plain_text("$$\nE = mc^2\n$$"), vec!["E = mc²"]);
    }

    #[test]
    fn strikethrough_keeps_the_text_and_is_crossed_out() {
        let rendered = Markdown::new("~~gone~~", 0, 0).render(80).join("\n");
        assert!(rendered.contains("\x1b[9m"), "{rendered:?}");
        assert_eq!(crate::ansi::strip_ansi(&rendered), "gone");
    }

    #[test]
    fn backslash_escapes_are_resolved_by_default() {
        assert_eq!(plain_text("Literal \\*stars\\* here."), vec!["Literal *stars* here."]);
    }

    #[test]
    fn backslash_escapes_can_be_preserved() {
        let options = MarkdownOptions {
            preserve_backslash_escapes: true,
            ..MarkdownOptions::default()
        };
        assert_eq!(
            plain_with("Literal \\*stars\\* here.", options),
            vec!["Literal \\*stars\\* here."]
        );
    }

    #[test]
    fn paragraphs_and_lists_are_separated_by_a_blank_line() {
        assert_eq!(
            plain_text("First paragraph.\n\nSecond paragraph."),
            vec!["First paragraph.", "", "Second paragraph."]
        );
        assert_eq!(
            plain_text("Paragraph\n- item"),
            vec!["Paragraph", "- item"]
        );
    }

    #[test]
    fn block_quote_gets_a_border() {
        assert_eq!(plain_text("> quoted"), vec!["│ quoted"]);
    }

    #[test]
    fn horizontal_rule_is_capped_at_eighty_columns() {
        let lines = Markdown::new("---", 0, 0).render(200);
        assert_eq!(visible_width(&lines[0]), 80);
    }

    #[test]
    fn empty_content_renders_no_lines() {
        assert!(Markdown::new("", 0, 0).render(80).is_empty());
        assert!(Markdown::new("   \n\t\n", 0, 0).render(80).is_empty());
    }

    #[test]
    fn long_lines_wrap_at_word_boundaries() {
        let lines = Markdown::new("one two three four five six seven eight nine ten", 0, 0)
            .render(20)
            .iter()
            .map(|line| crate::ansi::strip_ansi(line))
            .collect::<Vec<String>>();
        assert_eq!(lines, vec!["one two three four", "five six seven eight", "nine ten"]);
    }

    #[test]
    fn padding_applies_to_every_line() {
        let lines = Markdown::new("# Title", 1, 0).render(80);
        assert_eq!(crate::ansi::strip_ansi(&lines[0]), " Title");
    }
}
