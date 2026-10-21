//! The port's own view of a turn's latency.
//!
//! Three moments matter to a user: the moment the input is submitted, the
//! moment the first token is on screen, and the moment the assistant's message
//! is complete. The benchmark under `bench/roundtrip/` reads them from here, so
//! it can tell the port's own overhead apart from the client's view of the
//! stream.
//!
//! The instrumentation is off unless `RPI_TURN_TIMING=1` is set, and when it
//! is off it costs one relaxed atomic load per event: no allocation, no lock,
//! no change to what the user sees. When it is on, the port writes one
//! `turn_timing` JSON line to stderr at the end of the turn.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;
use std::sync::Mutex;
use std::time::Instant;

const ENV_VAR: &str = "RPI_TURN_TIMING";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnPhase {
	Submitted,
	FirstToken,
	TurnEnd,
}

impl TurnPhase {
	pub fn label(self) -> &'static str {
		match self {
			Self::Submitted => "submitted",
			Self::FirstToken => "first_token",
			Self::TurnEnd => "turn_end",
		}
	}
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TurnTiming {
	pub submit_ns: Option<u64>,
	pub first_token_ns: Option<u64>,
	pub turn_end_ns: Option<u64>,
	pub phases: Vec<TurnPhase>,
}

impl TurnTiming {
	pub fn submit_ms(&self) -> Option<f64> {
		self.submit_ns.map(|ns| ns as f64 / 1_000_000.0)
	}

	pub fn first_token_ms(&self) -> Option<f64> {
		self.first_token_ns.map(|ns| ns as f64 / 1_000_000.0)
	}

	pub fn turn_end_ms(&self) -> Option<f64> {
		self.turn_end_ns.map(|ns| ns as f64 / 1_000_000.0)
	}

	/// The time from the submit to the first token, in milliseconds.
	pub fn submit_to_first_token_ms(&self) -> Option<f64> {
		match (self.submit_ns, self.first_token_ns) {
			(Some(submit), Some(first)) => Some((first.saturating_sub(submit)) as f64 / 1_000_000.0),
			_ => None,
		}
	}

	/// The time from the first token to the end of the turn, in milliseconds.
	pub fn first_token_to_turn_end_ms(&self) -> Option<f64> {
		match (self.first_token_ns, self.turn_end_ns) {
			(Some(first), Some(end)) => Some((end.saturating_sub(first)) as f64 / 1_000_000.0),
			_ => None,
		}
	}

	/// The time from the submit to the end of the turn, in milliseconds.
	pub fn submit_to_turn_end_ms(&self) -> Option<f64> {
		match (self.submit_ns, self.turn_end_ns) {
			(Some(submit), Some(end)) => Some((end.saturating_sub(submit)) as f64 / 1_000_000.0),
			_ => None,
		}
	}
}

/// The process's start, so the reported times mean "since the port started".
static BASE: LazyLock<Instant> = LazyLock::new(Instant::now);

fn elapsed_ns() -> u64 {
	BASE.elapsed().as_nanos() as u64
}

static STATE: LazyLock<Mutex<Option<TurnTiming>>> = LazyLock::new(|| Mutex::new(None));

static ENABLED: LazyLock<bool> =
	LazyLock::new(|| std::env::var(ENV_VAR).map(|v| v == "1").unwrap_or(false));

/// True once the turn's first token has been recorded. The check keeps the
/// per-token path free of a lock and of an allocation.
static FIRST_TOKEN_SEEN: AtomicBool = AtomicBool::new(false);

/// True once the turn's end has been recorded.
static TURN_END_SEEN: AtomicBool = AtomicBool::new(false);

pub fn enabled() -> bool {
	*ENABLED
}

/// Anchor the reported times to the process's start.
///
/// Called once from the CLI's entry path, so `submit_ms` is the time since the
/// port booted rather than the time since the first recorded phase.
pub fn init() {
	LazyLock::force(&BASE);
}

/// Record a phase into a timing. Returns true when the phase was not
/// recorded yet.
impl TurnTiming {
	fn record(&mut self, phase: TurnPhase, now: u64) -> bool {
		let fresh = match phase {
			TurnPhase::Submitted => {
				*self = TurnTiming::default();
				self.submit_ns = Some(now);
				true
			}
			TurnPhase::FirstToken => {
				if self.first_token_ns.is_none() {
					self.first_token_ns = Some(now);
					true
				} else {
					false
				}
			}
			TurnPhase::TurnEnd => {
				if self.turn_end_ns.is_none() {
					self.turn_end_ns = Some(now);
					true
				} else {
					false
				}
			}
		};
		if !self.phases.contains(&phase) {
			self.phases.push(phase);
		}
		fresh
	}
}

/// Record a phase in the process's current turn.
fn record(phase: TurnPhase) -> bool {
	let Ok(mut guard) = STATE.lock() else {
		return false;
	};
	let now = elapsed_ns();
	guard
		.get_or_insert_with(TurnTiming::default)
		.record(phase, now)
}

pub fn submit() {
	if !enabled() {
		return;
	}
	FIRST_TOKEN_SEEN.store(false, Ordering::Relaxed);
	TURN_END_SEEN.store(false, Ordering::Relaxed);
	record(TurnPhase::Submitted);
}

pub fn first_token() {
	if !enabled() {
		return;
	}
	if FIRST_TOKEN_SEEN.load(Ordering::Relaxed) {
		return;
	}
	if record(TurnPhase::FirstToken) {
		FIRST_TOKEN_SEEN.store(true, Ordering::Relaxed);
	}
}

pub fn turn_end() {
	if !enabled() {
		return;
	}
	if TURN_END_SEEN.load(Ordering::Relaxed) {
		return;
	}
	if !record(TurnPhase::TurnEnd) {
		return;
	}
	TURN_END_SEEN.store(true, Ordering::Relaxed);
	emit();
}

pub fn snapshot() -> Option<TurnTiming> {
	STATE.lock().ok().and_then(|guard| guard.clone())
}

pub fn format_line(timing: &TurnTiming) -> String {
	let phases: Vec<&str> = timing.phases.iter().map(|phase| phase.label()).collect();
	serde_json::json!({
		"type": "turn_timing",
		"submit_ms": timing.submit_ms(),
		"first_token_ms": timing.first_token_ms(),
		"turn_end_ms": timing.turn_end_ms(),
		"submit_to_first_token_ms": timing.submit_to_first_token_ms(),
		"first_token_to_turn_end_ms": timing.first_token_to_turn_end_ms(),
		"submit_to_turn_end_ms": timing.submit_to_turn_end_ms(),
		"phases": phases,
	})
	.to_string()
}

fn emit() {
	let Some(timing) = snapshot() else {
		return;
	};
	eprintln!("{}", format_line(&timing));
}

/// Fold an agent event into the turn's timing.
pub fn observe_event(event: &rpi_agent::AgentEvent) {
	use rpi_ai::types::AssistantMessageEvent;
	match event {
		rpi_agent::AgentEvent::MessageUpdate {
			assistant_message_event,
			..
		} => {
			if let AssistantMessageEvent::TextDelta { delta, .. } = assistant_message_event {
				if !delta.is_empty() {
					first_token();
				}
			}
		}
		rpi_agent::AgentEvent::AgentSettled { .. } => {
			turn_end();
		}
		_ => {}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A timing with the three phases recorded at the given nanosecond marks.
	fn recorded() -> TurnTiming {
		let mut timing = TurnTiming::default();
		timing.record(TurnPhase::Submitted, 1_000);
		timing.record(TurnPhase::FirstToken, 4_000);
		timing.record(TurnPhase::TurnEnd, 9_000);
		timing
	}

	#[test]
	fn disabled_without_env() {
		if std::env::var_os(ENV_VAR).is_none() {
			assert!(!enabled());
		}
	}

	#[test]
	fn records_the_three_phases_in_order() {
		let timing = recorded();
		assert_eq!(
			timing.phases,
			vec![
				TurnPhase::Submitted,
				TurnPhase::FirstToken,
				TurnPhase::TurnEnd
			]
		);
		let submit = timing.submit_ns.expect("submit timestamp");
		let first = timing.first_token_ns.expect("first token timestamp");
		let end = timing.turn_end_ns.expect("turn end timestamp");
		assert!(submit <= first, "submit must not be after the first token");
		assert!(first <= end, "the first token must not be after the turn end");
	}

	#[test]
	fn first_token_is_recorded_once() {
		let mut timing = TurnTiming::default();
		timing.record(TurnPhase::Submitted, 1_000);
		assert!(timing.record(TurnPhase::FirstToken, 4_000));
		assert!(!timing.record(TurnPhase::FirstToken, 5_000));
		assert_eq!(timing.first_token_ns, Some(4_000));
	}

	#[test]
	fn the_turn_end_is_recorded_once() {
		let mut timing = TurnTiming::default();
		timing.record(TurnPhase::Submitted, 1_000);
		timing.record(TurnPhase::FirstToken, 4_000);
		assert!(timing.record(TurnPhase::TurnEnd, 9_000));
		assert!(!timing.record(TurnPhase::TurnEnd, 12_000));
		assert_eq!(timing.turn_end_ns, Some(9_000));
	}

	#[test]
	fn a_new_submit_resets_the_turn() {
		let mut timing = recorded();
		timing.record(TurnPhase::Submitted, 20_000);
		assert_eq!(timing.phases, vec![TurnPhase::Submitted]);
		assert!(timing.first_token_ns.is_none());
		assert!(timing.turn_end_ns.is_none());
		assert_eq!(timing.submit_ns, Some(20_000));
	}

	#[test]
	fn the_line_carries_the_timestamps_in_order() {
		let timing = recorded();
		let line = format_line(&timing);
		let parsed: serde_json::Value = serde_json::from_str(&line).expect("a json line");
		assert_eq!(parsed["type"], "turn_timing");
		assert_eq!(
			parsed["phases"],
			serde_json::json!(["submitted", "first_token", "turn_end"])
		);
		let submit = parsed["submit_ms"].as_f64().expect("submit_ms");
		let first = parsed["first_token_ms"].as_f64().expect("first_token_ms");
		let end = parsed["turn_end_ms"].as_f64().expect("turn_end_ms");
		assert!(submit >= 0.0, "submit_ms must not be negative");
		assert!(submit <= first, "submit must not be after the first token");
		assert!(first <= end, "the first token must not be after the turn end");
	}

	#[test]
	fn the_line_carries_the_deltas() {
		let timing = recorded();
		let parsed: serde_json::Value =
			serde_json::from_str(&format_line(&timing)).expect("a json line");
		let submit_to_first = parsed["submit_to_first_token_ms"]
			.as_f64()
			.expect("submit_to_first_token_ms");
		let first_to_end = parsed["first_token_to_turn_end_ms"]
			.as_f64()
			.expect("first_token_to_turn_end_ms");
		let submit_to_end = parsed["submit_to_turn_end_ms"]
			.as_f64()
			.expect("submit_to_turn_end_ms");
		assert!((submit_to_first - 0.003).abs() < 0.000_001);
		assert!((first_to_end - 0.005).abs() < 0.000_001);
		assert!((submit_to_end - 0.008).abs() < 0.000_001);
	}

	#[test]
	fn the_deltas_are_the_differences_of_the_stamps() {
		let timing = recorded();
		let submit_to_first = timing.submit_to_first_token_ms().expect("submit to first token");
		let first_to_end = timing.first_token_to_turn_end_ms().expect("first token to end");
		let submit_to_end = timing.submit_to_turn_end_ms().expect("submit to end");
		assert!((submit_to_first + first_to_end - submit_to_end).abs() < 0.000_001);
	}

	#[test]
	fn a_missing_phase_has_no_delta() {
		let mut timing = TurnTiming::default();
		timing.record(TurnPhase::Submitted, 1_000);
		assert!(timing.submit_to_first_token_ms().is_none());
		assert!(timing.first_token_to_turn_end_ms().is_none());
		assert!(timing.submit_to_turn_end_ms().is_none());
	}
}
