use std::sync::Arc;

use rpi_js::{ProcessHost, Runtime};
use serde_json::json;

const EXTENSION: &str = r#"
	import { defineTool } from "@earendil-works/pi-coding-agent";
	import { Type } from "typebox";

	export default function (api) {
		api.registerTool(
			defineTool({
				name: "greet",
				label: "Greet",
				description: "greets somebody",
				parameters: Type.Object({ who: Type.String() }),
				execute: async (_toolCallId, params) => ({
					content: [{ type: "text", text: `hello ${params.who}` }],
				}),
			}),
		);

		api.on("session_start", async (event) => ({
			started: event.type,
			tools: api.getAllTools().length,
		}));
	}
"#;

#[test]
fn a_tool_registered_in_javascript_runs_in_rust() {
	let host = Arc::new(ProcessHost::new());
	let mut runtime = Runtime::new(host).expect("the runtime starts");

	let loaded = runtime.load_extension("greet.ts", EXTENSION).expect("the extension loads");
	assert_eq!(loaded["path"], "greet.ts");

	let tools = runtime.tools().expect("the tools are listed");
	assert_eq!(tools.as_array().expect("a list").len(), 1);
	assert_eq!(tools[0]["name"], "greet");
	assert_eq!(tools[0]["label"], "Greet");

	let result = runtime
		.call_tool("greet", json!({ "who": "world" }))
		.expect("the tool runs");
	assert_eq!(result["content"][0]["text"], "hello world");
}

#[test]
fn an_event_reaches_the_extension_and_comes_back() {
	let host = Arc::new(ProcessHost::new());
	let mut runtime = Runtime::new(host).expect("the runtime starts");
	runtime.load_extension("greet.ts", EXTENSION).expect("the extension loads");

	let answer = runtime
		.dispatch("session_start", json!({ "type": "session_start" }))
		.expect("the event is answered");
	assert_eq!(answer["started"], "session_start");
	assert_eq!(answer["tools"], 0);
}

#[test]
fn the_host_answers_the_node_surfaces() {
	let host = Arc::new(ProcessHost::new());
	let mut runtime = Runtime::new(host).expect("the runtime starts");

	let cwd = runtime.eval("process.cwd()").expect("the cwd is there");
	assert!(cwd.is_string());
	let now = runtime.eval("performance.now()").expect("the clock is there");
	assert!(now.as_f64().expect("a number") >= 0.0);
	let platform = runtime.eval("process.platform").expect("the platform is there");
	assert!(platform.is_string());
}

#[test]
fn an_extension_imports_a_file_next_to_it() {
	let directory = tempfile::tempdir().expect("a directory");
	std::fs::write(
		directory.path().join("greeting.ts"),
		"export const greeting = (who: string) => `hello ${who}`;\n",
	)
	.expect("the helper is written");

	let extension = r#"
		import { greeting } from "./greeting.ts";

		export default function (api) {
			api.registerTool({
				name: "greet",
				execute: async (_toolCallId, params) => ({
					content: [{ type: "text", text: greeting(params.who) }],
				}),
			});
		}
	"#;

	let host = Arc::new(ProcessHost::with_root(directory.path()));
	let mut runtime = Runtime::new(host).expect("the runtime starts");
	let path = directory.path().join("main.ts");
	runtime
		.load_extension(path.to_str().expect("a path"), extension)
		.expect("the extension loads");

	let result = runtime
		.call_tool("greet", json!({ "who": "world" }))
		.expect("the tool runs");
	assert_eq!(result["content"][0]["text"], "hello world");
}

/// A host that records the operations the extension host asks for.
#[derive(Default)]
struct RecordingHost {
	ops: std::sync::Mutex<Vec<(String, serde_json::Value)>>,
}

impl rpi_js::Host for RecordingHost {
	fn call(&self, op: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
		self.ops.lock().unwrap().push((op.to_string(), args));
		match op {
			"context.mode" => Ok(json!("tui")),
			"theme.get" => Ok(json!({ "fg": { "accent": "\u{1b}[36m" } })),
			_ => Ok(serde_json::Value::Null),
		}
	}
}

const SCREEN_EXTENSION: &str = r#"
	import { Text } from "@earendil-works/pi-tui";

	export default function (api) {
		api.registerCommand("greet", {
			description: "greets",
			handler: async (args) => `hello ${args}`,
		});

		api.on("session_start", async (_event, ctx) => {
			ctx.ui.setStatus("demo", ctx.ui.theme.fg("accent", "Ready"));
			ctx.ui.notify("started", "info");
			ctx.ui.setWidget("above", ["Above editor widget"]);
		});
	}
"#;

#[test]
fn an_extension_reaches_the_screen_through_the_host() {
	let host = Arc::new(RecordingHost::default());
	let mut runtime = Runtime::new(host.clone()).expect("the runtime starts");
	runtime
		.load_extension("screen.ts", SCREEN_EXTENSION)
		.expect("the extension loads");

	runtime
		.dispatch("session_start", json!({ "type": "session_start" }))
		.expect("the event is answered");

	let ops = host.ops.lock().unwrap().clone();
	let status = ops
		.iter()
		.find(|(op, _)| op == "ui.setStatus")
		.expect("the status is published");
	assert_eq!(status.1["key"], "demo");
	assert!(status.1["text"].as_str().unwrap().contains("Ready"));

	let widget = ops
		.iter()
		.find(|(op, _)| op == "ui.setWidget")
		.expect("the widget is placed");
	assert_eq!(widget.1["key"], "above");
	assert_eq!(widget.1["lines"][0], "Above editor widget");

	let commands = runtime
		.call("__piExtensionHost.listCommands", &[])
		.expect("the commands are listed");
	assert_eq!(commands[0]["name"], "greet");
	assert_eq!(commands[0]["description"], "greets");
}

#[test]
fn a_command_registered_in_javascript_runs_in_rust() {
	let host = Arc::new(RecordingHost::default());
	let mut runtime = Runtime::new(host).expect("the runtime starts");
	runtime
		.load_extension("screen.ts", SCREEN_EXTENSION)
		.expect("the extension loads");

	let answer = runtime
		.call(
			"__piExtensionHost.runCommand",
			&[json!("greet"), json!("world")],
		)
		.expect("the command runs");
	assert_eq!(answer, "hello world");
}
