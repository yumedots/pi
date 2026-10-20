//! The runtime that holds the isolate and bridges the host and the JavaScript.

use std::fmt;
use std::path::Path;
use std::sync::{Arc, LazyLock};

use serde_json::{json, Value};

use crate::host::Host;
use crate::transpile;

const BOOT: &str = include_str!("boot.js");
const PRELUDE: &str = include_str!("node_surfaces.js");
const BUNDLE: &str = include_str!("../js/extension-host.bundle.js");

static PLATFORM: LazyLock<v8::SharedRef<v8::Platform>> = LazyLock::new(|| {
	let platform = v8::new_default_platform(0, false).make_shared();
	v8::V8::initialize_platform(platform.clone());
	v8::V8::initialize();
	platform
});

/// Everything that can go wrong while the runtime talks to the JavaScript.
#[derive(Debug)]
pub enum Error {
	/// The JavaScript raised an exception.
	Js(String),
	/// The host refused or failed an operation.
	Host(String),
	/// A value did not survive the JSON boundary.
	Json(String),
	/// The extension source could not be transpiled.
	Transpile(String),
	/// The runtime was asked for something it does not have.
	Missing(String),
}

impl fmt::Display for Error {
	fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Error::Js(message) => write!(formatter, "javascript error: {message}"),
			Error::Host(message) => write!(formatter, "host error: {message}"),
			Error::Json(message) => write!(formatter, "json error: {message}"),
			Error::Transpile(message) => write!(formatter, "transpile error: {message}"),
			Error::Missing(message) => write!(formatter, "missing: {message}"),
		}
	}
}

impl std::error::Error for Error {}

/// A live JavaScript runtime.
///
/// The runtime owns one isolate. It is created when the first extension needs
/// it, so a session without a JavaScript extension never starts V8.
pub struct Runtime {
	isolate: v8::OwnedIsolate,
	context: v8::Global<v8::Context>,
	host: Arc<dyn Host>,
}

impl Runtime {
	/// Creates the runtime, installs the host bridge and evaluates the bundled
	/// extension host.
	pub fn new(host: Arc<dyn Host>) -> Result<Self, Error> {
		let _platform = &*PLATFORM;
		let mut isolate = v8::Isolate::new(v8::CreateParams::default());
		isolate.set_slot(host.clone());
		let context = {
			v8::scope!(let scope, &mut *isolate);
			let context = v8::Context::new(scope, Default::default());
			v8::Global::new(scope, context)
		};
		let mut runtime = Runtime { isolate, context, host };
		runtime.install_bridge()?;
		runtime.run_script(BOOT)?;
		runtime.run_source(PRELUDE)?;
		runtime.run_source(BUNDLE)?;
		// The bundle may have replaced the global `process`; the host's object
		// is the one the extensions get.
		runtime.run_source("globalThis.process = globalThis.__piProcess;")?;
		Ok(runtime)
	}

	/// The host this runtime answers with.
	pub fn host(&self) -> &Arc<dyn Host> {
		&self.host
	}

	/// Evaluates a script and returns its value as JSON.
	pub fn eval(&mut self, source: &str) -> Result<Value, Error> {
		self.call("__piEval", &[json!(source)])
	}

	/// Calls a function the JavaScript put on the global object.
	///
	/// Every argument and the result cross the boundary as JSON.
	pub fn call(&mut self, name: &str, args: &[Value]) -> Result<Value, Error> {
		let name = Value::String(name.to_string()).to_string();
		let arguments = Value::Array(args.to_vec()).to_string();
		let response = self.call_async("__piCall", &[name, arguments])?;
		let ok = response.get("ok").and_then(Value::as_bool).unwrap_or(false);
		if ok {
			return Ok(response.get("value").cloned().unwrap_or(Value::Null));
		}
		let message = response
			.get("error")
			.and_then(Value::as_str)
			.unwrap_or("the call failed")
			.to_string();
		Err(Error::Js(message))
	}

	/// Sends an event to the extension host and returns its answer.
	pub fn dispatch(&mut self, event: &str, payload: Value) -> Result<Value, Error> {
		self.call("__piExtensionHost.dispatch", &[json!(event), payload])
	}

	/// Loads an extension: the TypeScript is transpiled and evaluated, and the
	/// factory it exports is called with the extension API.
	pub fn load_extension(&mut self, path: &str, source: &str) -> Result<Value, Error> {
		let code = transpile::transpile(source, Path::new(path)).map_err(Error::Transpile)?;
		self.call("__piExtensionHost.loadExtension", &[json!(path), json!(code)])
	}

	/// Calls a tool the extension registered.
	pub fn call_tool(&mut self, name: &str, arguments: Value) -> Result<Value, Error> {
		self.call("__piExtensionHost.callTool", &[json!(name), arguments])
	}

	/// The tools the loaded extensions registered.
	pub fn tools(&mut self) -> Result<Value, Error> {
		self.call("__piExtensionHost.listTools", &[])
	}

	/// Shuts the runtime down and releases the isolate.
	pub fn shutdown(self) {}

	fn run_script(&mut self, source: &str) -> Result<(), Error> {
		v8::scope!(let scope, &mut *self.isolate);
		let context = v8::Local::new(scope, &self.context);
		let scope = &mut v8::ContextScope::new(scope, context);
		let code = v8::String::new(scope, source)
			.ok_or_else(|| Error::Js("the script is not a string".into()))?;
		let script = v8::Script::compile(scope, code, None)
			.ok_or_else(|| Error::Js("the script did not compile".into()))?;
		script
			.run(scope)
			.ok_or_else(|| Error::Js("the script did not run".into()))?;
		Ok(())
	}

	fn run_source(&mut self, source: &str) -> Result<(), Error> {
		let response = self.call_async("__piRun", &[source.to_string()])?;
		if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
			return Ok(());
		}
		let message = response
			.get("error")
			.and_then(Value::as_str)
			.unwrap_or("the script failed")
			.to_string();
		Err(Error::Js(message))
	}

	fn install_bridge(&mut self) -> Result<(), Error> {
		v8::scope!(let scope, &mut *self.isolate);
		let context = v8::Local::new(scope, &self.context);
		let scope = &mut v8::ContextScope::new(scope, context);
		let template = v8::FunctionTemplate::new(scope, host_call);
		let function = template
			.get_function(scope)
			.ok_or_else(|| Error::Js("the host bridge did not compile".into()))?;
		let global = context.global(scope);
		let name = v8::String::new(scope, "__piHostCall")
			.ok_or_else(|| Error::Js("the host bridge has no name".into()))?;
		global
			.set(scope, name.into(), function.into())
			.ok_or_else(|| Error::Js("the host bridge was not installed".into()))?;
		Ok(())
	}

	fn call_async(&mut self, name: &str, arguments: &[String]) -> Result<Value, Error> {
		let value = {
			v8::scope!(let scope, &mut *self.isolate);
			let context = v8::Local::new(scope, &self.context);
			let scope = &mut v8::ContextScope::new(scope, context);
			let global = context.global(scope);
			let key = v8::String::new(scope, name).ok_or_else(|| Error::Js("invalid name".into()))?;
			let target = global
				.get(scope, key.into())
				.ok_or_else(|| Error::Missing(name.to_string()))?;
			let function = v8::Local::<v8::Function>::try_from(target)
				.map_err(|_| Error::Missing(name.to_string()))?;
			let arguments = arguments
				.iter()
				.map(|argument| v8::String::new(scope, argument).unwrap().into())
				.collect::<Vec<v8::Local<v8::Value>>>();
			let undefined = v8::undefined(scope).into();
			let result = function
				.call(scope, undefined, &arguments)
				.ok_or_else(|| Error::Js("the call failed".into()))?;
			v8::Global::new(scope, result)
		};
		self.settle(&value)
	}

	/// Run the timers whose deadline has come.
	///
	/// The embedded host has no event loop, so a timer only fires when the
	/// runtime pumps the queue — which it does while it waits for a promise to
	/// settle. An extension that awaits a timer therefore makes progress.
	fn run_due_timers(&mut self) {
		v8::scope!(let scope, &mut *self.isolate);
		let context = v8::Local::new(scope, &self.context);
		let scope = &mut v8::ContextScope::new(scope, context);
		let global = context.global(scope);
		let Some(key) = v8::String::new(scope, "__piRunDueTimers") else {
			return;
		};
		let Some(target) = global.get(scope, key.into()) else {
			return;
		};
		let Ok(function) = v8::Local::<v8::Function>::try_from(target) else {
			return;
		};
		let undefined = v8::undefined(scope).into();
		function.call(scope, undefined, &[]);
	}

	fn settle(&mut self, value: &v8::Global<v8::Value>) -> Result<Value, Error> {
		for _ in 0..100_000 {
			let state = {
				v8::scope!(let scope, &mut *self.isolate);
				let context = v8::Local::new(scope, &self.context);
				let scope = &mut v8::ContextScope::new(scope, context);
				let local = v8::Local::new(scope, value);
				match v8::Local::<v8::Promise>::try_from(local) {
					Ok(promise) => promise.state(),
					Err(_) => return to_json(scope, local),
				}
			};
			match state {
				v8::PromiseState::Pending => {
					self.isolate.perform_microtask_checkpoint();
					self.run_due_timers();
				}
				_ => break,
			}
		}
		v8::scope!(let scope, &mut *self.isolate);
		let context = v8::Local::new(scope, &self.context);
		let scope = &mut v8::ContextScope::new(scope, context);
		let local = v8::Local::new(scope, value);
		let Ok(promise) = v8::Local::<v8::Promise>::try_from(local) else {
			return to_json(scope, local);
		};
		match promise.state() {
			v8::PromiseState::Fulfilled => to_json(scope, promise.result(scope)),
			v8::PromiseState::Rejected => {
				let reason = promise.result(scope);
				let text = reason
					.to_string(scope)
					.map(|value| value.to_rust_string_lossy(scope))
					.unwrap_or_else(|| "the promise was rejected".to_string());
				Err(Error::Js(text))
			}
			v8::PromiseState::Pending => Err(Error::Js("the promise did not settle".into())),
		}
	}
}

fn load_module(host: &dyn Host, arguments: &Value) -> Result<Value, String> {
	let path = arguments
		.get("path")
		.and_then(Value::as_str)
		.ok_or_else(|| "the module load has no path".to_string())?
		.to_string();
	let source = host.call("fs.readFile", json!({ "path": path }))?;
	let source = source.as_str().unwrap_or_default().to_string();
	let code = transpile::transpile(&source, Path::new(&path)).map_err(|error| error.to_string())?;
	Ok(json!({ "path": path, "code": code }))
}

fn to_json(scope: &v8::PinScope, value: v8::Local<v8::Value>) -> Result<Value, Error> {
	if value.is_undefined() || value.is_null() {
		return Ok(Value::Null);
	}
	if value.is_string() {
		let text = value.to_string(scope).unwrap().to_rust_string_lossy(scope);
		return serde_json::from_str(&text).map_err(|error| Error::Json(error.to_string()));
	}
	let json = v8::json::stringify(scope, value).ok_or_else(|| Error::Json("not JSON".into()))?;
	let text = json.to_rust_string_lossy(scope);
	serde_json::from_str(&text).map_err(|error| Error::Json(error.to_string()))
}

fn host_call(
	scope: &mut v8::PinScope,
	args: v8::FunctionCallbackArguments,
	mut rv: v8::ReturnValue,
) {
	let op = args.get(0).to_string(scope).map(|value| value.to_rust_string_lossy(scope));
	let raw = args.get(1).to_string(scope).map(|value| value.to_rust_string_lossy(scope));
	let host = scope.get_slot::<Arc<dyn Host>>().cloned();
	let response = match (host, op, raw) {
		(Some(host), Some(op), Some(raw)) => {
			let arguments: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
			let outcome = if op == "module.load" {
				load_module(host.as_ref(), &arguments)
			} else {
				host.call(&op, arguments)
			};
			match outcome {
				Ok(value) => json!({ "ok": true, "value": value }),
				Err(message) => json!({ "ok": false, "error": message }),
			}
		}
		_ => json!({ "ok": false, "error": "the host call was malformed" }),
	};
	let text = response.to_string();
	if let Some(value) = v8::String::new(scope, &text) {
		rv.set(value.into());
	}
}
