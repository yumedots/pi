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

/// An extension may import the node builtins.
///
/// A builtin that does not resolve is fatal: the extension host throws
/// `cannot resolve "<spec>"` and the whole extension fails to load.
#[test]
fn an_extension_imports_the_node_builtins() {
	const IMPORTS: &str = r#"
		import * as os from "node:os";
		import * as url from "node:url";
		import * as perfHooks from "node:perf_hooks";
		import * as childProcess from "node:child_process";
		import * as path from "node:path";

		export default function (api) {
			api.registerCommand("node-builtins", {
				description: "the node builtins resolve",
				handler: async () => ({
					home: os.homedir(),
					platform: os.platform(),
					file: url.fileURLToPath("file:///tmp/x"),
					now: typeof perfHooks.performance.now,
					exec: typeof childProcess.exec,
					join: path.join("a", "b"),
				}),
			});
		}
	"#;

	let host = Arc::new(ProcessHost::new());
	let mut runtime = Runtime::new(host).expect("the runtime starts");
	runtime
		.load_extension("builtins.ts", IMPORTS)
		.expect("the extension loads");

	let answer = runtime
		.call("__piExtensionHost.runCommand", &[json!("node-builtins"), json!("")])
		.expect("the command runs");
	assert_eq!(answer["platform"], std::env::consts::OS);
	assert_eq!(answer["join"], "a/b");
	assert_eq!(answer["now"], "function");
	assert_eq!(answer["exec"], "function");
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

/// An extension that imports a subpath the host does not publish still loads.
///
/// The original publishes every subpath of its packages, so a missing one is
/// a gap on this side. Throwing would kill the whole extension, so the
/// subpath resolves to an empty module and only the names it wanted are
/// missing.
#[test]
fn an_extension_imports_a_subpath_the_host_does_not_publish() {
	const IMPORTS: &str = r#"
		import { somethingProvider } from "@earendil-works/pi-ai/providers/anthropic";

		export default function (api) {
			api.registerCommand("subpath", {
				description: "the extension loaded",
				handler: async () => ({ loaded: true, provider: typeof somethingProvider }),
			});
		}
	"#;

	let host = Arc::new(ProcessHost::new());
	let mut runtime = Runtime::new(host).expect("the runtime starts");
	runtime
		.load_extension("subpath.ts", IMPORTS)
		.expect("the extension loads");

	let answer = runtime
		.call("__piExtensionHost.runCommand", &[json!("subpath"), json!("")])
		.expect("the command runs");
	assert_eq!(answer["loaded"], true);
	assert_eq!(answer["provider"], "undefined");
}

/// An extension whose factory registers after an `await` is registered.
///
/// The original awaits the factory before it commits the registrations, so an
/// extension that registers late is registered by the time the load returns.
#[test]
fn an_async_factory_registers_before_the_load_returns() {
	const ASYNC: &str = r#"
		export default async function (api) {
			await new Promise((resolve) => setTimeout(resolve, 10));
			api.registerCommand("async-cmd", {
				description: "registered after an await",
				handler: async () => "late",
			});
			api.registerTool({
				name: "async_tool",
				label: "Async",
				description: "d",
				parameters: { type: "object", properties: {} },
				execute: async () => ({ output: "late" }),
			});
		}
	"#;

	let host = Arc::new(ProcessHost::new());
	let mut runtime = Runtime::new(host).expect("the runtime starts");
	runtime
		.load_extension("async.ts", ASYNC)
		.expect("the extension loads");

	let tools = runtime.tools().expect("the tools are listed");
	assert_eq!(tools.as_array().expect("a list").len(), 1);
	assert_eq!(tools[0]["name"], "async_tool");

	let commands = runtime
		.call("__piExtensionHost.listCommands", &[])
		.expect("the commands are listed");
	assert_eq!(commands.as_array().expect("a list").len(), 1);
	assert_eq!(commands[0]["name"], "async-cmd");
}

/// Every shim in the shim directory is reachable by an extension.
///
/// A builtin that an extension cannot import kills the extension at load
/// time, and the shim list grew one builtin at a time. This test walks the
/// directory, so a shim that is not published fails here.
#[test]
fn every_shim_is_reachable_by_an_extension() {
    let shim_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("js/shims");
    let mut checked = 0;
    for entry in std::fs::read_dir(&shim_dir).expect("the shim directory") {
        let entry = entry.expect("a shim");
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".ts") {
            continue;
        }
        let specifier = shim_specifier(&name);
        let source = format!(
            "import * as builtin from \"node:{specifier}\";\n\
             export default function () {{ return typeof builtin; }}\n"
        );
        let host = Arc::new(ProcessHost::new());
        let mut runtime = Runtime::new(host).expect("the runtime starts");
        runtime
            .load_extension(&format!("{specifier}.ts"), &source)
            .unwrap_or_else(|error| panic!("`node:{specifier}` does not resolve: {error}"));
        checked += 1;
    }
    assert!(checked > 30, "the shim directory looks empty: {checked} shims");
}

/// The builtin a shim file stands for.
fn shim_specifier(file_name: &str) -> String {
    let stem = file_name.trim_end_matches(".ts");
    let stem = stem.strip_prefix("node-").unwrap_or(stem);
    for (dashed, slashed) in [
        ("fs-promises", "fs/promises"),
        ("stream-promises", "stream/promises"),
        ("stream-web", "stream/web"),
        ("readline-promises", "readline/promises"),
        ("timers-promises", "timers/promises"),
    ] {
        if stem == dashed {
            return slashed.to_string();
        }
    }
    stem.replace('-', "_")
}

/// An extension that writes a file writes the file.
///
/// A write that reports success and writes nothing is a silent data-loss
/// bug, and the `fs` module is the one an extension reaches for it.
#[test]
fn an_extension_writes_a_file() {
    let directory = tempfile::tempdir().expect("a directory");
    let path = directory.path().join("written.txt");
    let source = format!(
        "import {{ writeFileSync }} from \"node:fs\";\n\
         export default function () {{ writeFileSync({:?}, \"hello\"); }}\n",
        path.to_string_lossy()
    );

    let host = Arc::new(ProcessHost::new());
    let mut runtime = Runtime::new(host).expect("the runtime starts");
    runtime
        .load_extension("write.ts", &source)
        .expect("the extension loads");

    assert_eq!(
        std::fs::read_to_string(&path).expect("the file was written"),
        "hello",
        "the extension's write did not land"
    );
}

/// An extension that reads `import.meta` loads.
///
/// The extension host evaluates an extension's module as a script, and
/// `import.meta` is a syntax error outside a module; the transpiler rewrites
/// it to the object the evaluator provides.
#[test]
fn an_extension_reads_import_meta() {
    const SOURCE: &str = r#"
		export default function (api) {
			api.registerCommand("meta", {
				description: "the module's own url",
				handler: async () => ({ url: import.meta.url }),
			});
		}
	"#;

    let host = Arc::new(ProcessHost::new());
    let mut runtime = Runtime::new(host).expect("the runtime starts");
    runtime
        .load_extension("meta.ts", SOURCE)
        .expect("the extension loads");

    let answer = runtime
        .call("__piExtensionHost.runCommand", &[json!("meta"), json!("")])
        .expect("the command runs");
    assert_eq!(answer["url"], "file://meta.ts");
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
