# Interactive session search parity — TypeScript original vs. Rust port

Area: the session picker's search query language only (the query parser, the
matcher and the filter/sort). The picker UI itself is the interactive mode's
area.

* Original: `/Users/gabriel/pi/packages/coding-agent/src/modes/interactive/components/session-selector-search.ts` (branch `perf/lightweight-harness`)
* Port: `/Users/gabriel/pi-native/rpi/crates/rpi-cli/src/interactive_tui/session_search.rs` (branch `feat/rpi-native`)

Reading the port: `rpi/crates/rpi-cli/src/…` means the path relative to
`/Users/gabriel/pi-native/`. Reading the original: `packages/…` means the path
relative to `/Users/gabriel/pi`.

---

## 1. The query language

**What the user sees.** The session picker's search box accepts either a regex
(`re:<pattern>`) or a list of words. Words match fuzzily (the letters may be
scattered); a word wrapped in double quotes (`"node cve"`) must appear
verbatim. Every word must match, otherwise the session is dropped from the
list.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/session-selector-search.ts:39` (`parseSearchQuery`), `:116` (`matchSession`) |
| Port | `rpi/crates/rpi-cli/src/interactive_tui/session_search.rs:174` (`parse_search_query`), `:241` (`match_session_text`) |

**Observed in the original.**

```
parseSearchQuery('foo "node cve" bar')
→ { mode: "tokens", tokens: [ {kind:"fuzzy",value:"foo"}, {kind:"phrase",value:"node cve"}, {kind:"fuzzy",value:"bar"} ] }

parseSearchQuery('foo "node cve')      // unclosed quote
→ { mode: "tokens", tokens: [ {kind:"fuzzy",value:"foo"}, {kind:"fuzzy",value:"\"node"}, {kind:"fuzzy",value:"cve"} ] }

parseSearchQuery('re:')
→ { mode: "regex", tokens: [], regex: null, error: "Empty regex" }

parseSearchQuery('re:[oops')
→ { mode: "regex", tokens: [], regex: null, error: "Invalid regular expression: …" }
```

**Port.** `parse_search_query` reproduces the three tokenising rules verbatim
(quote-aware flush, whitespace flush, unclosed-quote fallback to plain
whitespace tokenisation) and the `re:` prefix with the `Empty regex` error.
`match_session_text` reproduces the scoring: a phrase hit contributes
`index * 0.1` on the whitespace-normalised, lowercased text; a fuzzy token
contributes the TUI fuzzy score; a token that does not match fails the whole
query; an empty token list matches everything with score 0.

**Check.** `rpi/crates/rpi-cli/src/interactive_tui/session_search.rs` tests
`parses_plain_query_into_fuzzy_tokens`, `parses_empty_query_into_no_tokens`,
`parses_quoted_phrase_tokens`, `unclosed_quote_falls_back_to_whitespace_tokens`,
`parses_regex_mode`, `rejects_empty_regex`, `rejects_invalid_regex`,
`phrase_token_matches_case_insensitively`, `phrase_token_that_does_not_match`,
`fuzzy_token_that_does_not_match`, `every_token_must_match`,
`regex_match_scores_by_index`, `invalid_regex_matches_nothing`,
`empty_query_matches_everything`.

---

## 2. The regex subset is hand-written, not the `regex` crate

**What the user sees.** `re:` patterns work for the common cases (literals,
`.`, `*`, `+`, `?`, `[…]`, `^`, `$`, `|`) and are case-insensitive, like the
original's `new RegExp(pattern, "i")`. A pattern outside that subset reports
an error and matches nothing — the same outcome the original has for an
invalid pattern.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/session-selector-search.ts:57` (`new RegExp(pattern, "i")`) |
| Port | `rpi/crates/rpi-cli/src/interactive_tui/session_search.rs:809` (`Regex`), `:577` (`PatternParser`), `:466` (`match_all`) |

**Port.** `rpi-cli` has no `regex` dependency, so the file carries a small
backtracking matcher: a parser for the supported subset (plus groups, the
`\d`/`\w`/`\s` shorthands and `\{n,m}`-free literals) and a matcher that
returns every reachable end position, greedy first. `Regex::new` returns an
error message for an unbalanced group, an unterminated class, a quantifier
without an atom, a trailing backslash or a reversed range; `parse_search_query`
stores that message in `error`, which makes `filter_and_sort` return no rows —
the original's "invalid pattern ⇒ no match" behaviour.

**Difference to know about.** The original's `RegExp` accepts the full
JavaScript syntax (counted quantifiers `{2,3}`, lookbehind, backreferences,
Unicode property escapes). The port accepts the documented subset only; the
rest is reported as an error instead of being matched. The port's match index
is a character index, the original's is a UTF-16 code-unit index, so scores
differ for text with astral characters before the match.

**Check.** Tests `regex_matches_literals_case_insensitively`,
`regex_matches_dot_and_star`, `regex_matches_plus_and_question_mark`,
`regex_matches_character_classes`, `regex_matches_shorthand_classes`,
`regex_matches_anchors`, `regex_matches_alternatives`,
`regex_search_returns_leftmost_index`, `regex_rejects_unsupported_patterns`.

---

## 3. The search text and the name filter

**What the user sees.** A session is searched by id, name, message text and
working directory; the "named only" toggle hides sessions without a name (a
name of only spaces counts as no name).

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/session-selector-search.ts:26` (`getSessionSearchText`), `:30` (`hasSessionName`), `:34` (`matchesNameFilter`) |
| Port | `rpi/crates/rpi-cli/src/interactive_tui/session_search.rs:103` (`SessionCandidate::search_text`), `:114` (`SessionCandidate::has_name`) |

**Port.** `SessionCandidate` is the port's session row for this purpose
(`id`, `name`, `all_messages_text`, `cwd`, `modified_ms`).
`search_text()` formats `` `${id} ${name ?? ""} ${all_messages_text} ${cwd}` ``
exactly as the original does.

**Check.** Test `search_text_uses_id_name_text_and_cwd` and
`named_filter_drops_unnamed_sessions`.

---

## 4. Sorting

**What the user sees.** `recent` keeps the order the sessions came in (the
picker refreshes it newest first); `relevance` puts the best-scoring session
first and breaks ties by the newer session.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/session-selector-search.ts:156` (`filterAndSortSessions`) |
| Port | `rpi/crates/rpi-cli/src/interactive_tui/session_search.rs:327` (`filter_and_sort`) |

**Port.** `filter_and_sort` applies the name filter first; an empty query
returns the name-filtered list unchanged; a query that failed to parse returns
no rows; `SortMode::Recent` filters and keeps the incoming order;
`SortMode::Relevance` and `SortMode::Threaded` sort by ascending score with
the newer `modified_ms` first on a tie — the original routes `threaded`
through the same scored branch (`filterAndSortSessions` has no separate
`threaded` case).

**Check.** Tests `recent_keeps_incoming_order`,
`relevance_sorts_by_score_with_newer_tie_break`,
`relevance_tie_breaks_on_newer_modified`,
`invalid_regex_query_yields_no_sessions`.

---

## 5. The fuzzy score comes from the TUI library

**What the user sees.** Fuzzy tokens are scored the same way the rest of the
picker scores fuzzy matches, so the ordering of the results matches the
original's.

| | |
|---|---|
| Original | `packages/tui/src/fuzzy.ts:12` (`fuzzyMatch`, imported by `session-selector-search.ts:1`) |
| Port | `rpi/crates/rpi-tui/src/fuzzy.rs:35` (`fuzzy_match`), used by `rpi/crates/rpi-cli/src/interactive_tui/session_search.rs:11` |

**Port.** `match_session_text` calls `rpi_tui::fuzzy::fuzzy_match` — the port
of the original's `fuzzyMatch` — so the score is the TUI library's score
rather than a second implementation.

**Check.** The port of `fuzzyMatch` is covered by
`rpi/crates/rpi-tui/src/fuzzy.rs`'s own tests; the session-search tests cover
the way the score is summed and used for ordering.
