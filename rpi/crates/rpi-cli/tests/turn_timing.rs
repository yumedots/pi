use std::io::{BufRead, Read, Write};
use std::net::TcpListener;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::Value;

/// A mock provider: one HTTP server that answers a chat-completions request
/// with a streamed OpenAI-compatible answer.
fn start_mock_provider() -> (String, mpsc::Receiver<()>) {
	let listener = TcpListener::bind("127.0.0.1:0").expect("a mock provider port");
	let address = listener.local_addr().expect("the mock provider address");
	let (sender, receiver) = mpsc::channel();
	std::thread::spawn(move || {
		for stream in listener.incoming() {
			let Ok(mut stream) = stream else { continue };
			let mut buffer = Vec::new();
			let mut chunk = [0u8; 4096];
			let mut header_end = None;
			let mut content_length = 0usize;
			loop {
				let read = match stream.read(&mut chunk) {
					Ok(0) => break,
					Ok(read) => read,
					Err(_) => break,
				};
				buffer.extend_from_slice(&chunk[..read]);
				if header_end.is_none() {
					if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
						header_end = Some(index + 4);
						let headers = String::from_utf8_lossy(&buffer[..index]).to_lowercase();
						for line in headers.lines() {
							if let Some(value) = line.strip_prefix("content-length:") {
								content_length = value.trim().parse().unwrap_or(0);
							}
						}
					}
				}
				if let Some(end) = header_end {
					if buffer.len() >= end + content_length {
						break;
					}
				}
			}
			let mut body = String::new();
			body.push_str("HTTP/1.1 200 OK\r\n");
			body.push_str("content-type: text/event-stream\r\n");
			body.push_str("cache-control: no-cache\r\n");
			body.push_str("connection: close\r\n\r\n");
			let usage = "{\"prompt_tokens\":42,\"completion_tokens\":7,\"total_tokens\":49}";
			for word in ["Hello", " from", " the", " mock."] {
				let chunk = format!(
					"data: {}\n\n",
					serde_json::json!({
						"id": "chatcmpl-test",
						"object": "chat.completion.chunk",
						"created": 0,
						"model": "mock-1",
						"choices": [{ "index": 0, "delta": { "content": word }, "finish_reason": Value::Null }],
						"usage": usage,
					})
				);
				body.push_str(&chunk);
			}
			body.push_str(&format!(
				"data: {}\n\n",
				serde_json::json!({
					"id": "chatcmpl-test",
					"object": "chat.completion.chunk",
					"created": 0,
					"model": "mock-1",
					"choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }],
					"usage": usage,
				})
			));
			body.push_str("data: [DONE]\n\n");
			let _ = stream.write_all(body.as_bytes());
			let _ = stream.flush();
			let _ = stream.shutdown(std::net::Shutdown::Write);
			let _ = sender.send(());
		}
	});
	(format!("http://{address}/v1"), receiver)
}

fn write_agent_dir(dir: &std::path::Path, base_url: &str) {
	std::fs::create_dir_all(dir).expect("the agent directory");
	let models = serde_json::json!({
		"providers": {
			"mock": {
				"baseUrl": base_url,
				"api": "openai-completions",
				"apiKey": "parity-key",
				"models": [
					{ "id": "mock-1", "name": "Mock Model", "contextWindow": 128000, "maxTokens": 4096 }
				]
			}
		}
	});
	std::fs::write(
		dir.join("models.json"),
		format!("{}\n", serde_json::to_string_pretty(&models).expect("the models document")),
	)
	.expect("the models file");
}

#[test]
fn the_port_timestamps_the_turn_and_writes_them_in_order() {
	let (base_url, _served) = start_mock_provider();
	let temp = tempfile::tempdir().expect("a temporary directory");
	let agent_dir = temp.path().join("agent");
	write_agent_dir(&agent_dir, &base_url);
	let work = temp.path().join("work");
	std::fs::create_dir_all(&work).expect("the work directory");

	let mut child = Command::new(env!("CARGO_BIN_EXE_rpi"))
		.args([
			"--mode",
			"rpc",
			"--no-session",
			"--offline",
			"--provider",
			"mock",
			"--model",
			"mock/mock-1",
			"--api-key",
			"parity-key",
		])
		.current_dir(&work)
		.env("PI_CODING_AGENT_DIR", &agent_dir)
		.env("RPI_TURN_TIMING", "1")
		.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.spawn()
		.expect("the rpi binary");

	let mut stdin = child.stdin.take().expect("the stdin pipe");
	let stdout = child.stdout.take().expect("the stdout pipe");
	let stderr = child.stderr.take().expect("the stderr pipe");

	let (out_sender, out_receiver) = mpsc::channel();
	std::thread::spawn(move || {
		let mut reader = std::io::BufReader::new(stdout);
		loop {
			let mut line = String::new();
			match reader.read_line(&mut line) {
				Ok(0) | Err(_) => break,
				Ok(_) => {}
			}
			if line.trim().is_empty() {
				continue;
			}
			if out_sender.send(line).is_err() {
				break;
			}
		}
	});

	let (err_sender, err_receiver) = mpsc::channel();
	std::thread::spawn(move || {
		let mut reader = std::io::BufReader::new(stderr);
		loop {
			let mut line = String::new();
			match reader.read_line(&mut line) {
				Ok(0) | Err(_) => break,
				Ok(_) => {}
			}
			if line.trim().is_empty() {
				continue;
			}
			if err_sender.send(line).is_err() {
				break;
			}
		}
	});

	stdin
		.write_all(b"{\"id\":\"s\",\"type\":\"get_state\"}\n")
		.expect("the state request");

	let deadline = Instant::now() + Duration::from_secs(60);
	let mut submitted = false;
	let mut settled = false;
	while Instant::now() < deadline {
		let Ok(line) = out_receiver.recv_timeout(Duration::from_secs(5)) else {
			continue;
		};
		let Ok(event) = serde_json::from_str::<Value>(&line) else {
			continue;
		};
		if event["id"] == "s" && event["type"] == "response" && !submitted {
			submitted = true;
			stdin
				.write_all(b"{\"id\":\"p0\",\"type\":\"prompt\",\"content\":\"hello\",\"message\":\"hello\"}\n")
				.expect("the prompt");
			continue;
		}
		if event["type"] == "agent_settled" {
			settled = true;
			break;
		}
	}
	assert!(settled, "the turn never settled");

	let mut timing_lines = Vec::new();
	while let Ok(line) = err_receiver.recv_timeout(Duration::from_millis(500)) {
		if line.contains("\"turn_timing\"") {
			timing_lines.push(line);
		}
	}
	let _ = child.kill();
	let _ = child.wait();

	assert_eq!(
		timing_lines.len(),
		1,
		"the port must write exactly one turn_timing line per turn, got {timing_lines:?}"
	);
	let line = timing_lines[0].trim();
	assert!(!line.contains('\n'), "the turn_timing line must be one json line");
	let timing: Value = serde_json::from_str(line).expect("the turn_timing line is json");
	assert_eq!(timing["type"], "turn_timing");
	let submit = timing["submit_ms"].as_f64().expect("submit_ms");
	let first_token = timing["first_token_ms"].as_f64().expect("first_token_ms");
	let turn_end = timing["turn_end_ms"].as_f64().expect("turn_end_ms");
	assert!(submit >= 0.0, "submit_ms must not be negative");
	assert!(
		submit <= first_token,
		"the submit must not be after the first token: {submit} > {first_token}"
	);
	assert!(
		first_token <= turn_end,
		"the first token must not be after the turn end: {first_token} > {turn_end}"
	);
	let phases: Vec<&str> = timing["phases"]
		.as_array()
		.expect("the phases")
		.iter()
		.map(|phase| phase.as_str().expect("a phase name"))
		.collect();
	assert_eq!(
		phases,
		vec!["submitted", "first_token", "turn_end"],
		"the phases must be emitted in order"
	);
	let submit_to_first = timing["submit_to_first_token_ms"]
		.as_f64()
		.expect("submit_to_first_token_ms");
	let first_to_end = timing["first_token_to_turn_end_ms"]
		.as_f64()
		.expect("first_token_to_turn_end_ms");
	let submit_to_end = timing["submit_to_turn_end_ms"]
		.as_f64()
		.expect("submit_to_turn_end_ms");
	assert!(
		submit_to_first >= 0.0 && first_to_end >= 0.0 && submit_to_end >= 0.0,
		"the deltas must not be negative: {submit_to_first} {first_to_end} {submit_to_end}"
	);
	assert!(
		(submit_to_first + first_to_end - submit_to_end).abs() < 0.001,
		"the deltas must add up: {submit_to_first} + {first_to_end} != {submit_to_end}"
	);
}

/// Without `RPI_TURN_TIMING=1` the port writes no timing line at all, so a
/// benchmark that expects one can tell "not instrumented" from "measured zero".
#[test]
fn the_port_writes_no_timing_line_without_the_env_var() {
	let (base_url, _served) = start_mock_provider();
	let temp = tempfile::tempdir().expect("a temporary directory");
	let agent_dir = temp.path().join("agent");
	write_agent_dir(&agent_dir, &base_url);
	let work = temp.path().join("work");
	std::fs::create_dir_all(&work).expect("the work directory");

	let mut child = Command::new(env!("CARGO_BIN_EXE_rpi"))
		.args([
			"--mode",
			"rpc",
			"--no-session",
			"--offline",
			"--provider",
			"mock",
			"--model",
			"mock/mock-1",
			"--api-key",
			"parity-key",
		])
		.current_dir(&work)
		.env("PI_CODING_AGENT_DIR", &agent_dir)
		.env_remove("RPI_TURN_TIMING")
		.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.spawn()
		.expect("the rpi binary");

	let mut stdin = child.stdin.take().expect("the stdin pipe");
	let stdout = child.stdout.take().expect("the stdout pipe");
	let stderr = child.stderr.take().expect("the stderr pipe");

	let (out_sender, out_receiver) = mpsc::channel();
	std::thread::spawn(move || {
		let mut reader = std::io::BufReader::new(stdout);
		loop {
			let mut line = String::new();
			match reader.read_line(&mut line) {
				Ok(0) | Err(_) => break,
				Ok(_) => {}
			}
			if line.trim().is_empty() {
				continue;
			}
			if out_sender.send(line).is_err() {
				break;
			}
		}
	});

	let (err_sender, err_receiver) = mpsc::channel();
	std::thread::spawn(move || {
		let mut reader = std::io::BufReader::new(stderr);
		loop {
			let mut line = String::new();
			match reader.read_line(&mut line) {
				Ok(0) | Err(_) => break,
				Ok(_) => {}
			}
			if line.trim().is_empty() {
				continue;
			}
			if err_sender.send(line).is_err() {
				break;
			}
		}
	});

	stdin
		.write_all(b"{\"id\":\"s\",\"type\":\"get_state\"}\n")
		.expect("the state request");

	let deadline = Instant::now() + Duration::from_secs(60);
	let mut submitted = false;
	let mut settled = false;
	while Instant::now() < deadline {
		let Ok(line) = out_receiver.recv_timeout(Duration::from_secs(5)) else {
			continue;
		};
		let Ok(event) = serde_json::from_str::<Value>(&line) else {
			continue;
		};
		if event["id"] == "s" && event["type"] == "response" && !submitted {
			submitted = true;
			stdin
				.write_all(b"{\"id\":\"p0\",\"type\":\"prompt\",\"content\":\"hello\",\"message\":\"hello\"}\n")
				.expect("the prompt");
			continue;
		}
		if event["type"] == "agent_settled" {
			settled = true;
			break;
		}
	}
	assert!(settled, "the turn never settled");

	let mut stderr_text = String::new();
	while let Ok(line) = err_receiver.recv_timeout(Duration::from_millis(500)) {
		stderr_text.push_str(&line);
	}
	let _ = child.kill();
	let _ = child.wait();

	assert!(
		!stderr_text.contains("\"turn_timing\""),
		"the port must stay silent without RPI_TURN_TIMING=1, got: {stderr_text}"
	);
}
