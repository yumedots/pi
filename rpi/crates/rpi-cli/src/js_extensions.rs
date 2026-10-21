//! The JavaScript extension backend.
//!
//! pi's TypeScript extensions run inside the embedded V8 of `rpi-js`. This
//! module is the host side of that boundary: it finds the extension files on
//! disk, loads them into the runtime, and gives the extensions the context
//! they need to change the screen (a status line, a notification, a widget, a
//! slash command, a tool).
//!
//! The runtime owns a V8 isolate, which cannot leave its thread, so it lives
//! on a thread of its own. The host state (the chat, the widget slots, the
//! status registry) is shared and thread safe, and the extensions reach it
//! through the [`rpi_js::Host`] operations.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, RwLock};

use rpi_tui::Container;
use serde_json::{json, Value};

/// The directory name pi keeps its project-local files in.
const CONFIG_DIR_NAME: &str = ".pi";

/// A component an extension registered, and the slot it lives in.
#[derive(Debug, Clone)]
pub enum JsComponent {
    /// Plain text lines the extension handed over.
    Lines(Vec<String>),
    /// A component the host renders through the extension host.
    Component(String),
}

impl std::fmt::Display for JsComponent {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JsComponent::Lines(lines) => write!(formatter, "lines:{}", lines.join("\u{1}")),
            JsComponent::Component(id) => write!(formatter, "component:{id}"),
        }
    }
}

/// A widget an extension placed above or below the editor.
#[derive(Debug, Clone)]
pub struct JsWidget {
    pub key: String,
    pub placement: String,
    pub component: JsComponent,
}

/// A slash command an extension registered.
#[derive(Debug, Clone)]
pub struct JsCommand {
    pub name: String,
    pub description: String,
    pub path: String,
}

/// The state the extensions share with the TUI.
#[derive(Default)]
struct JsState {
    chat: Mutex<Option<Arc<Container>>>,
    widget_above: Mutex<Option<Arc<Container>>>,
    widget_below: Mutex<Option<Arc<Container>>>,
    widgets: Mutex<Vec<JsWidget>>,
    header: Mutex<Option<JsComponent>>,
    footer: Mutex<Option<JsComponent>>,
    status: Mutex<Vec<(String, String)>>,
    commands: Mutex<Vec<JsCommand>>,
    render: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
    session: Mutex<Option<Arc<JsSession>>>,
}

/// The live session the JavaScript host answers from.
///
/// The TUI fills it once the session is up: the harness-backed actions, the
/// editor, the chrome hooks, and the lists an extension may read. Every field
/// is behind a lock, because the host answers from the V8 thread while the
/// TUI writes from its own.
pub struct JsSession {
    /// The harness-backed host: the same one the native plugins drive.
    pub actions: Option<Arc<dyn rpi_extensions::RuntimeActionHost>>,
    /// The session-scoped dialog mailbox the TUI drains.
    pub ui_dialog: Option<rpi_extensions::UiDialogMailbox>,
    /// The session-scoped editor-text queue the TUI drains.
    pub editor_text: Option<rpi_extensions::EditorTextMailbox>,
    /// The runtime the harness runs on; the host blocks on it for the
    /// asynchronous operations.
    pub runtime: Option<tokio::runtime::Handle>,
    /// The prompt editor: `getEditorText` and `setEditorText` read and write it.
    pub editor: Option<Arc<rpi_tui::Editor>>,
    /// Set the terminal window title.
    pub set_title: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    /// Set the working message, or hide the working indicator.
    pub set_working: Option<Arc<dyn Fn(Option<String>) + Send + Sync>>,
    /// The slash commands the session offers.
    pub commands: RwLock<Vec<Value>>,
    /// The git branch the footer shows.
    pub git_branch: RwLock<Option<String>>,
    /// Whether the agent is streaming.
    pub idle: AtomicBool,
    /// Whether messages are queued behind the running turn.
    pub pending_messages: AtomicBool,
    /// The MCP servers the extensions registered.
    pub mcp_servers: RwLock<Vec<Value>>,
    /// The providers the extensions registered, by name.
    pub providers: RwLock<BTreeMap<String, Value>>,
    /// The virtual models the extensions registered.
    pub virtual_models: RwLock<Vec<(String, String)>>,
    /// The flags the extensions registered.
    pub flags: RwLock<BTreeMap<String, Value>>,
    /// The themes the session offers.
    pub themes: RwLock<Vec<Value>>,
    /// The custom editor component, when one is installed.
    pub editor_component: RwLock<Option<String>>,
    /// Whether the tool output is expanded.
    pub tools_expanded: AtomicBool,
    /// The session's identity: id, file, directory, leaf and display name.
    pub session_id: RwLock<Option<String>>,
    pub session_file: RwLock<Option<String>>,
    pub session_dir: RwLock<Option<String>>,
    pub leaf_id: RwLock<Option<String>>,
    pub session_name: RwLock<Option<String>>,
    /// The merged effective settings.
    pub settings: RwLock<Value>,
    /// The project-trust decision for this context.
    pub project_trusted: AtomicBool,
}

impl Default for JsSession {
    fn default() -> Self {
        Self {
            actions: None,
            ui_dialog: None,
            editor_text: None,
            runtime: None,
            editor: None,
            set_title: None,
            set_working: None,
            commands: RwLock::new(Vec::new()),
            git_branch: RwLock::new(None),
            idle: AtomicBool::new(true),
            pending_messages: AtomicBool::new(false),
            mcp_servers: RwLock::new(Vec::new()),
            providers: RwLock::new(BTreeMap::new()),
            virtual_models: RwLock::new(Vec::new()),
            flags: RwLock::new(BTreeMap::new()),
            themes: RwLock::new(Vec::new()),
            editor_component: RwLock::new(None),
            tools_expanded: AtomicBool::new(false),
            session_id: RwLock::new(None),
            session_file: RwLock::new(None),
            session_dir: RwLock::new(None),
            leaf_id: RwLock::new(None),
            session_name: RwLock::new(None),
            settings: RwLock::new(Value::Object(serde_json::Map::new())),
            project_trusted: AtomicBool::new(true),
        }
    }
}

/// The request the runtime thread answers.
enum JsRequest {
    Load {
        path: String,
        source: String,
        reply: Sender<Result<Value, String>>,
    },
    Dispatch {
        event: String,
        payload: Value,
        reply: Sender<Result<Value, String>>,
    },
    RunCommand {
        name: String,
        args: String,
        reply: Sender<Result<Value, String>>,
    },
    EmitInput {
        text: String,
        reply: Sender<Result<Value, String>>,
    },
    CallTool {
        name: String,
        args: Value,
        reply: Sender<Result<Value, String>>,
    },
    RenderComponent {
        id: String,
        width: usize,
        reply: Sender<Result<Vec<String>, String>>,
    },
    Tools {
        reply: Sender<Result<Value, String>>,
    },
    Commands {
        reply: Sender<Result<Value, String>>,
    },
}

/// The JavaScript extension backend.
///
/// The handle is cheap to clone and safe to share: the runtime lives on its
/// own thread, the state is behind mutexes.
#[derive(Clone)]
pub struct JsExtensions {
    state: Arc<JsState>,
    requests: Arc<Mutex<Option<Sender<JsRequest>>>>,
}

impl JsExtensions {
    /// Start the runtime thread.
    pub fn new() -> Self {
        let state = Arc::new(JsState::default());
        let (requests, receiver) = channel::<JsRequest>();
        let thread_state = state.clone();
        std::thread::Builder::new()
            .name("rpi-js-extensions".into())
            .spawn(move || run_runtime(thread_state, receiver))
            .expect("the extension thread starts");
        Self {
            state,
            requests: Arc::new(Mutex::new(Some(requests))),
        }
    }

    /// Attach the chat container the extensions write their notifications to.
    pub fn set_chat(&self, chat: Arc<Container>) {
        if let Ok(mut slot) = self.state.chat.lock() {
            *slot = Some(chat);
        }
    }

    /// Attach the widget slots above and below the editor.
    pub fn set_widget_slots(&self, above: Arc<Container>, below: Arc<Container>) {
        if let Ok(mut slot) = self.state.widget_above.lock() {
            *slot = Some(above);
        }
        if let Ok(mut slot) = self.state.widget_below.lock() {
            *slot = Some(below);
        }
    }

    /// Attach the callback that asks the TUI for a repaint.
    pub fn set_render_hook(&self, hook: Arc<dyn Fn() + Send + Sync>) {
        if let Ok(mut slot) = self.state.render.lock() {
            *slot = Some(hook);
        }
    }

    /// Publish the session's slash commands, so an extension can read them.
    pub fn set_commands(&self, commands: Vec<Value>) {
        if let Some(session) = self
            .state
            .session
            .lock()
            .ok()
            .and_then(|slot| slot.clone())
        {
            if let Ok(mut slot) = session.commands.write() {
                *slot = commands;
            }
        }
    }

    /// Attach the live session the host answers the session questions from.
    pub fn set_session(&self, session: Arc<JsSession>) {
        if let Ok(mut slot) = self.state.session.lock() {
            *slot = Some(session);
        }
    }

    /// The status texts the extensions published, in key order.
    pub fn statuses(&self) -> Vec<(String, String)> {
        self.state
            .status
            .lock()
            .map(|entries| entries.clone())
            .unwrap_or_default()
    }

    /// The widgets the extensions placed.
    pub fn widgets(&self) -> Vec<JsWidget> {
        self.state
            .widgets
            .lock()
            .map(|widgets| widgets.clone())
            .unwrap_or_default()
    }

    /// The custom header the extensions installed.
    pub fn header(&self) -> Option<JsComponent> {
        self.state
            .header
            .lock()
            .ok()
            .and_then(|header| header.clone())
    }

    /// The custom footer the extensions installed.
    pub fn footer(&self) -> Option<JsComponent> {
        self.state
            .footer
            .lock()
            .ok()
            .and_then(|footer| footer.clone())
    }

    /// The tools the extensions registered, in the shape the host declares
    /// them to the model.
    pub fn tools(&self) -> Vec<Value> {
        self.request(|reply| JsRequest::Tools { reply })
            .unwrap_or(Value::Array(Vec::new()))
            .as_array()
            .cloned()
            .unwrap_or_default()
    }

    /// The slash commands the extensions registered.
    pub fn commands(&self) -> Vec<JsCommand> {
        self.state
            .commands
            .lock()
            .map(|commands| commands.clone())
            .unwrap_or_default()
    }

    /// Load one extension file.
    pub fn load(&self, path: &Path) -> Result<Value, String> {
        let source = std::fs::read_to_string(path)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        self.request(|reply| JsRequest::Load {
            path: path.to_string_lossy().to_string(),
            source,
            reply,
        })
    }

    /// Send an event to every extension and return the first answer.
    pub fn dispatch(&self, event: &str, payload: Value) -> Result<Value, String> {
        self.request(|reply| JsRequest::Dispatch {
            event: event.to_string(),
            payload,
            reply,
        })
    }

    /// Run a command an extension registered.
    pub fn run_command(&self, name: &str, args: &str) -> Result<Value, String> {
        self.request(|reply| JsRequest::RunCommand {
            name: name.to_string(),
            args: args.to_string(),
            reply,
        })
    }

    /// Hand the user's input to the extensions.
    ///
    /// The extensions see the text before the agent does: one can transform it,
    /// or handle it without an agent run.
    pub fn emit_input(&self, text: &str) -> Result<Value, String> {
        self.request(|reply| JsRequest::EmitInput {
            text: text.to_string(),
            reply,
        })
    }

    /// Call a tool an extension registered.
    pub fn call_tool(&self, name: &str, args: Value) -> Result<Value, String> {
        self.request(|reply| JsRequest::CallTool {
            name: name.to_string(),
            args,
            reply,
        })
    }

    /// Render a component an extension registered.
    pub fn render_component(&self, id: &str, width: usize) -> Result<Vec<String>, String> {
        self.request(|reply| JsRequest::RenderComponent {
            id: id.to_string(),
            width,
            reply,
        })
    }

    fn request<T>(
        &self,
        build: impl FnOnce(Sender<Result<T, String>>) -> JsRequest,
    ) -> Result<T, String> {
        let sender = {
            let guard = self
                .requests
                .lock()
                .map_err(|_| "the extension runtime is gone".to_string())?;
            guard
                .as_ref()
                .cloned()
                .ok_or_else(|| "the extension runtime is gone".to_string())?
        };
        let (reply, answers) = channel();
        sender
            .send(build(reply))
            .map_err(|_| "the extension runtime is gone".to_string())?;
        answers
            .recv()
            .map_err(|_| "the extension runtime did not answer".to_string())?
    }
}

fn run_runtime(state: Arc<JsState>, requests: Receiver<JsRequest>) {
    let host = Arc::new(JsHost {
        state: state.clone(),
    });
    let mut runtime = match rpi_js::Runtime::new(host) {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("the JavaScript extension host did not start: {error}");
            return;
        }
    };
    for request in requests {
        match request {
            JsRequest::Load {
                path,
                source,
                reply,
            } => {
                let result = runtime
                    .load_extension(&path, &source)
                    .map_err(|error| error.to_string());
                if result.is_ok() {
                    collect_registrations(&mut runtime, &state);
                }
                let _ = reply.send(result);
                continue;
            }
            JsRequest::Dispatch {
                event,
                payload,
                reply,
            } => {
                let result = runtime
                    .dispatch(&event, payload)
                    .map_err(|error| error.to_string());
                let _ = reply.send(result);
                continue;
            }
            JsRequest::RunCommand { name, args, reply } => {
                let result = runtime
                    .call("__piExtensionHost.runCommand", &[json!(name), json!(args)])
                    .map_err(|error| error.to_string());
                let _ = reply.send(result);
                continue;
            }
            JsRequest::CallTool { name, args, reply } => {
                let result = runtime
                    .call_tool(&name, args)
                    .map_err(|error| error.to_string());
                let _ = reply.send(result);
                continue;
            }
            JsRequest::EmitInput { text, reply } => {
                let result = runtime
                    .call(
                        "__piExtensionHost.emitInput",
                        &[json!(text), Value::Null, json!("interactive")],
                    )
                    .map_err(|error| error.to_string());
                let _ = reply.send(result);
                continue;
            }
            JsRequest::Commands { reply } => {
                let commands = runtime
                    .call("__piExtensionHost.listCommands", &[])
                    .map_err(|error| error.to_string())
                    .unwrap_or(Value::Array(Vec::new()));
                let _ = reply.send(Ok(commands));
                continue;
            }
            JsRequest::Tools { reply } => {
                let tools = runtime
                    .tools()
                    .map_err(|error| error.to_string())
                    .unwrap_or(Value::Array(Vec::new()));
                let _ = reply.send(Ok(tools));
                continue;
            }
            JsRequest::RenderComponent { id, width, reply } => {
                let result = runtime
                    .call(
                        "__piExtensionHost.renderComponent",
                        &[json!(id), json!(width)],
                    )
                    .map_err(|error| error.to_string())
                    .and_then(|value| {
                        Ok(value
                            .as_array()
                            .map(|lines| {
                                lines
                                    .iter()
                                    .map(|line| line.as_str().unwrap_or_default().to_string())
                                    .collect()
                            })
                            .unwrap_or_default())
                    });
                let _ = reply.send(result);
                continue;
            }
        }
    }
}

/// Read the commands the extensions registered and keep them for the TUI.
fn collect_registrations(runtime: &mut rpi_js::Runtime, state: &Arc<JsState>) {
    let commands = runtime
        .call("__piExtensionHost.listCommands", &[])
        .unwrap_or(Value::Null);
    if let Ok(mut slot) = state.commands.lock() {
        *slot = commands
            .as_array()
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| {
                        let name = entry.get("name")?.as_str()?.to_string();
                        let description = entry
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        Some(JsCommand {
                            name,
                            description,
                            path: entry
                                .get("path")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
    }
}

/// The host operations the extension host calls.
struct JsHost {
    state: Arc<JsState>,
}

impl rpi_js::Host for JsHost {
    fn call(&self, op: &str, args: Value) -> Result<Value, String> {
        IN_HOST_CALL.with(|flag| flag.set(true));
        let answer = self.answer(op, args);
        IN_HOST_CALL.with(|flag| flag.set(false));
        answer
    }
}

impl JsHost {
    /// Answer one host operation.
    fn answer(&self, op: &str, args: Value) -> Result<Value, String> {
        match op {
            "context.mode" => Ok(json!("tui")),
            "theme.get" => Ok(rpi_js::theme_tokens()),
            "ui.notify" => {
                self.notify(&args);
                Ok(Value::Null)
            }
            "ui.setStatus" => {
                let key = args
                    .get("key")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let text = args
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if let Ok(mut entries) = self.state.status.lock() {
                    entries.retain(|(existing, _)| existing != &key);
                    if !text.is_empty() {
                        entries.push((key, text));
                        entries.sort_by(|left, right| left.0.cmp(&right.0));
                    }
                }
                self.request_render();
                Ok(Value::Null)
            }
            "ui.setWidget" => {
                self.set_widget(&args);
                Ok(Value::Null)
            }
            "ui.setHeader" => {
                let component = component_of(&args);
                if let Ok(mut slot) = self.state.header.lock() {
                    *slot = component;
                }
                self.request_render();
                Ok(Value::Null)
            }
            "ui.setFooter" => {
                let component = component_of(&args);
                if let Ok(mut slot) = self.state.footer.lock() {
                    *slot = component;
                }
                self.request_render();
                Ok(Value::Null)
            }
            "footer.getGitBranch" => Ok(self
                .session()
                .and_then(|session| session.git_branch.read().ok().and_then(|b| b.clone()))
                .map(Value::String)
                .unwrap_or(Value::Null)),
            "footer.getExtensionStatuses" => {
                let entries = self
                    .state
                    .status
                    .lock()
                    .map(|entries| {
                        entries
                            .iter()
                            .map(|(key, text)| (key.clone(), json!(text)))
                            .collect::<serde_json::Map<String, Value>>()
                    })
                    .unwrap_or_default();
                Ok(Value::Object(entries))
            }
            "ui.setTitle" => {
                let title = args.get("title").and_then(Value::as_str).unwrap_or("");
                if let Some(session) = self.session() {
                    if let Some(set_title) = session.set_title.clone() {
                        set_title(title);
                    }
                }
                Ok(Value::Null)
            }
            "ui.setWorkingMessage" => {
                let message = args.get("message").and_then(Value::as_str).unwrap_or("");
                self.set_working(if message.is_empty() {
                    None
                } else {
                    Some(message)
                });
                Ok(Value::Null)
            }
            "ui.setWorkingVisible" => {
                let visible = args.get("visible").and_then(Value::as_bool).unwrap_or(true);
                self.set_working(if visible { Some("") } else { None });
                Ok(Value::Null)
            }
            "ui.setWorkingIndicator" => {
                let frames = args
                    .get("options")
                    .and_then(|options| options.get("frames"))
                    .and_then(Value::as_array)
                    .map(|frames| {
                        frames
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<String>>()
                    })
                    .unwrap_or_default();
                if frames.is_empty() {
                    self.set_working(None);
                } else {
                    let message = frames.join(" ");
                    self.set_working(Some(&message));
                }
                Ok(Value::Null)
            }
            "ui.setHiddenThinkingLabel" => Ok(Value::Null),
            "ui.setEditorText" => {
                let text = args.get("text").and_then(Value::as_str).unwrap_or("");
                if let Some(session) = self.session() {
                    if let Some(editor) = session.editor.clone() {
                        editor.set_text(text);
                    }
                }
                Ok(Value::Null)
            }
            "ui.getEditorText" => Ok(self
                .session()
                .and_then(|session| session.editor.clone())
                .map(|editor| Value::String(editor.get_text()))
                .unwrap_or(Value::Null)),
            "ui.pasteToEditor" => {
                let text = args.get("text").and_then(Value::as_str).unwrap_or("");
                if let Some(session) = self.session() {
                    if let Some(editor) = session.editor.clone() {
                        editor.set_text(&format!("{}{}", editor.get_text(), text));
                    }
                }
                Ok(Value::Null)
            }
            "ui.select" | "ui.confirm" | "ui.input" | "ui.editor" => {
                let kind = args.get("kind").and_then(Value::as_str).unwrap_or("selector");
                self.dialog(kind, &args)
            }
            "ui.pollDialog" => self.poll_dialog(&args),
            "ui.custom" => {
                let component = args.get("component").and_then(Value::as_str);
                if let (Some(session), Some(component)) = (self.session(), component) {
                    if let Ok(mut slot) = session.editor_component.write() {
                        *slot = Some(component.to_string());
                    }
                }
                Ok(Value::Null)
            }
            "ui.setEditorComponent" => {
                let component = args.get("component").and_then(Value::as_str).map(str::to_string);
                if let Some(session) = self.session() {
                    if let Ok(mut slot) = session.editor_component.write() {
                        *slot = component;
                    }
                }
                Ok(Value::Null)
            }
            "ui.getEditorComponent" => Ok(self
                .session()
                .and_then(|session| session.editor_component.read().ok().and_then(|c| c.clone()))
                .map(Value::String)
                .unwrap_or(Value::Null)),
            "ui.getAllThemes" => {
                let from_session = self.session().and_then(|session| {
                    session
                        .themes
                        .read()
                        .ok()
                        .map(|themes| Value::Array(themes.clone()))
                });
                match from_session {
                    Some(list) if list
                        .as_array()
                        .is_some_and(|themes| !themes.is_empty()) =>
                    {
                        Ok(list)
                    }
                    _ => Ok(theme_list()),
                }
            }
            "ui.getTheme" => {
                let name = args.get("name").and_then(Value::as_str).unwrap_or("");
                let from_session = self.session().and_then(|session| {
                    session
                        .themes
                        .read()
                        .ok()
                        .and_then(|themes| {
                            themes
                                .iter()
                                .find(|theme| theme.get("name").and_then(Value::as_str) == Some(name))
                                .cloned()
                        })
                });
                Ok(from_session.unwrap_or_else(|| {
                    theme_list()
                        .as_array()
                        .and_then(|themes| {
                            themes
                                .iter()
                                .find(|theme| {
                                    theme.get("name").and_then(Value::as_str) == Some(name)
                                })
                                .cloned()
                        })
                        .unwrap_or(Value::Null)
                }))
            }
            "ui.setTheme" => Ok(json!({ "success": false, "error": "the theme is not changeable" })),
            "ui.getToolsExpanded" => Ok(json!(self
                .session()
                .map(|session| session.tools_expanded.load(Ordering::SeqCst))
                .unwrap_or(true))),
            "ui.setToolsExpanded" => {
                let expanded = args.get("expanded").and_then(Value::as_bool).unwrap_or(true);
                if let Some(session) = self.session() {
                    session.tools_expanded.store(expanded, Ordering::SeqCst);
                }
                Ok(Value::Null)
            }
            "agent.isIdle" => Ok(json!(self
                .session()
                .map(|session| session.idle.load(Ordering::SeqCst))
                .unwrap_or(true))),
            "agent.isProjectTrusted" => Ok(json!(self
                .session()
                .map(|session| session.project_trusted.load(Ordering::SeqCst))
                .unwrap_or(true))),
            "agent.hasPendingMessages" => Ok(json!(self
                .session()
                .map(|session| session.pending_messages.load(Ordering::SeqCst))
                .unwrap_or(false))),
            "agent.abort" => self.action(|host| {
                Box::pin(async move { host.abort(json!({})).await })
            }),
            "agent.compact" => self.action(move |host| {
                let payload = args.clone();
                Box::pin(async move { host.compact(payload).await })
            }),
            "agent.getContextUsage" => self.action(|host| {
                Box::pin(async move { host.get_context_usage(json!({})).await })
            }),
            "agent.getSystemPrompt" => self.action(|host| {
                Box::pin(async move { host.get_system_prompt(json!({})).await })
            }),
            "model.get" => self.action(|host| {
                Box::pin(async move { host.get_model(json!({})).await })
            }),
            "model.getThinkingLevel" => {
                // A model that cannot reason has only the "off" level, and the
                // original answers the level the model supports.
                let model = self.action(|host| {
                    Box::pin(async move { host.get_model(json!({})).await })
                })?;
                let reason = model
                    .get("reasoning")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if reason {
                    self.action(|host| {
                        Box::pin(async move { host.get_thinking_level(json!({})).await })
                    })
                } else {
                    Ok(json!({ "level": "off" }))
                }
            }
            "model.set" => {
                let model = args.get("model").cloned().unwrap_or(Value::Null);
                let id = model
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_default();
                let previous = self.action(|host| {
                    Box::pin(async move { host.get_model(json!({})).await })
                })?;
                self.action(|host| {
                    Box::pin(async move { host.set_model(json!({ "model": id })).await })
                })?;
                rpi_extensions::emit_event(
                    "model_select",
                    &json!({
                        "type": "model_select",
                        "model": model,
                        "previousModel": previous,
                        "source": "set",
                    }),
                );
                Ok(Value::Null)
            }
            "model.setThinkingLevel" => {
                let level = args.get("level").cloned().unwrap_or(Value::Null);
                let previous = self.action(|host| {
                    Box::pin(async move { host.get_thinking_level(json!({})).await })
                })?;
                let for_action = level.clone();
                self.action(move |host| {
                    let level = for_action.clone();
                    Box::pin(async move { host.set_thinking_level(json!({ "level": level })).await })
                })?;
                rpi_extensions::emit_event(
                    "thinking_level_select",
                    &json!({
                        "type": "thinking_level_select",
                        "level": level,
                        "previousLevel": previous.get("level").cloned().unwrap_or(Value::Null),
                    }),
                );
                Ok(Value::Null)
            }
            "model.registerVirtual" => {
                let model = args.get("model").cloned().unwrap_or(Value::Null);
                let provider = model
                    .get("provider")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let id = model
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if let Some(session) = self.session() {
                    if let Ok(mut models) = session.virtual_models.write() {
                        models.retain(|(existing, model)| !(existing == &provider && model == &id));
                        models.push((provider, id));
                    }
                }
                Ok(Value::Null)
            }
            "model.unregisterVirtual" => {
                let provider = args.get("provider").and_then(Value::as_str).unwrap_or("");
                let id = args.get("id").and_then(Value::as_str).unwrap_or("");
                if let Some(session) = self.session() {
                    if let Ok(mut models) = session.virtual_models.write() {
                        models.retain(|(existing, model)| !(existing == provider && model == id));
                    }
                }
                Ok(Value::Null)
            }
            "tools.getActive" => self.action(|host| {
                Box::pin(async move { host.get_active_tools(json!({})).await })
            }),
            "tools.getAll" => self.action(|host| {
                Box::pin(async move { host.get_all_tools(json!({})).await })
            }),
            "tools.setActive" => {
                let tools = args
                    .get("toolNames")
                    .and_then(Value::as_array)
                    .map(|names| {
                        names
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<String>>()
                    })
                    .unwrap_or_default();
                self.action(|host| {
                    Box::pin(async move { host.set_active_tools(json!({ "tools": tools })).await })
                })
            }
            "tools.getExposure" => Ok(json!("direct")),
            "tools.getNamespace" => Ok(Value::Null),
            "tools.getPromptGuidelines" => Ok(json!([])),
            "tools.execute" => Ok(Value::Null),
            "settings.get" => {
                // The effective values: the defaults applied, the project
                // settings merged over the global ones.
                if let Some(session) = self.session() {
                    if let Ok(settings) = session.settings.read() {
                        let empty = settings
                            .as_object()
                            .is_none_or(|settings| settings.is_empty());
                        if !settings.is_null() && !empty {
                            return Ok(settings.clone());
                        }
                    }
                }
                Ok(crate::settings::load_settings()
                    .map(|settings| settings.effective())
                    .unwrap_or_else(|_| Value::Object(serde_json::Map::new())))
            }
            "commands.get" => {
                // The session's commands, plus the ones the extensions
                // registered: the extension's own command is in the list, the
                // same way its own tool is in the active tool set.
                let mut commands = self
                    .session()
                    .and_then(|session| {
                        session
                            .commands
                            .read()
                            .ok()
                            .map(|commands| commands.clone())
                    })
                    .unwrap_or_default();
                for command in self.extension_commands() {
                    let name = command.name.clone();
                    if name.is_empty()
                        || commands.iter().any(|entry| {
                            entry.get("name").and_then(Value::as_str) == Some(&name)
                        })
                    {
                        continue;
                    }
                    commands.push(json!({
                        "name": name,
                        "description": command.description,
                        "source": "extension",
                        "sourceInfo": {
                            "path": command.path,
                            "source": "auto",
                            "scope": "user",
                            "origin": "top-level",
                        },
                    }));
                }
                Ok(Value::Array(commands))
            }
            "session.getSessionName" => Ok(self
                .session()
                .and_then(|session| session.session_name.read().ok().and_then(|n| n.clone()))
                .map(Value::String)
                .unwrap_or(Value::Null)),
            "session.setSessionName" => {
                let name = args
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let for_action = name.clone();
                self.action(move |host| {
                    let name = for_action.clone();
                    Box::pin(async move { host.set_session_name(json!({ "name": name })).await })
                })?;
                if let Some(session) = self.session() {
                    if let Ok(mut slot) = session.session_name.write() {
                        *slot = Some(name.to_string());
                    }
                }
                rpi_extensions::emit_event(
                    "session_info_changed",
                    &json!({ "type": "session_info_changed", "name": name }),
                );
                Ok(Value::Null)
            }
            "session.setLabel" => {
                let entry_id = args.get("entryId").and_then(Value::as_str).unwrap_or("");
                if entry_id.is_empty() {
                    return Err("Entry id not found".to_string());
                }
                Err("Entry id not found".to_string())
            }
            "session.getBranch" => self.action(|host| {
                Box::pin(async move { host.get_session_branch(json!({})).await })
            }),
            "session.getEntries" => self.action(|host| {
                Box::pin(async move { host.get_entries(json!({})).await })
            }),
            "session.getDir" => Ok(self
                .session()
                .and_then(|session| session.session_dir.read().ok().and_then(|d| d.clone()))
                .map(Value::String)
                .unwrap_or(Value::Null)),
            "session.getId" => Ok(self
                .session()
                .and_then(|session| session.session_id.read().ok().and_then(|i| i.clone()))
                .map(Value::String)
                .unwrap_or(Value::Null)),
            "session.getFile" => Ok(self
                .session()
                .and_then(|session| session.session_file.read().ok().and_then(|f| f.clone()))
                .map(Value::String)
                .unwrap_or(Value::Null)),
            "session.getLeafId" => Ok(self
                .session()
                .and_then(|session| session.leaf_id.read().ok().and_then(|l| l.clone()))
                .map(Value::String)
                .unwrap_or(Value::Null)),
            "session.getLeafEntry" => Ok(Value::Null),
            "session.getEntry" => Ok(Value::Null),
            "session.getLabel" => Ok(Value::Null),
            "session.buildContextEntries" => Ok(json!([])),
            "session.buildSessionProjection" => Ok(json!({})),
            "session.getHeader" => Ok(Value::Null),
            "session.getTree" => Ok(Value::Null),
            "session.getSystemPromptOptions" => self.action(|host| {
                Box::pin(async move { host.get_system_prompt_options(json!({})).await })
            }),
            "session.waitForIdle" => self.action(|host| {
                Box::pin(async move { host.wait_for_idle(json!({})).await })
            }),
            "session.newSession" => self.action(|host| {
                Box::pin(async move { host.new_session(json!({})).await })
            }),
            "session.fork" => self.action(move |host| {
                let payload = args.clone();
                Box::pin(async move { host.fork(payload).await })
            }),
            "session.navigateTree" => self.action(move |host| {
                let payload = args.clone();
                Box::pin(async move { host.navigate_tree(payload).await })
            }),
            "session.switchSession" => self.action(move |host| {
                let payload = args.clone();
                Box::pin(async move { host.switch_session(payload).await })
            }),
            "session.reload" => self.action(|host| {
                Box::pin(async move { host.reload(json!({})).await })
            }),
            "session.sendMessage" => self.action(move |host| {
                let payload = args.clone();
                Box::pin(async move { host.send_message(payload).await })
            }),
            "session.sendUserMessage" => self.action(move |host| {
                let payload = args.clone();
                Box::pin(async move { host.send_user_message(payload).await })
            }),
            "session.appendEntry" => self.action(move |host| {
                let payload = args.clone();
                Box::pin(async move { host.append_entry(payload).await })
            }),
            "session.exec" => self.action(move |host| {
                let payload = args.clone();
                Box::pin(async move { host.exec(payload).await })
            }),
            "session.shutdown" => Ok(Value::Null),
            "provider.register" => {
                let provider = args.get("provider").cloned().unwrap_or(Value::Null);
                let config = args.get("config").cloned().unwrap_or(Value::Null);
                let name = provider
                    .get("id")
                    .and_then(Value::as_str)
                    .or_else(|| config.get("name").and_then(Value::as_str))
                    .unwrap_or("")
                    .to_string();
                if let Some(session) = self.session() {
                    if let Ok(mut providers) = session.providers.write() {
                        providers.insert(name, config);
                    }
                }
                Ok(Value::Null)
            }
            "provider.unregister" => {
                let name = args.get("name").and_then(Value::as_str).unwrap_or("");
                if let Some(session) = self.session() {
                    if let Ok(mut providers) = session.providers.write() {
                        providers.remove(name);
                    }
                }
                Ok(Value::Null)
            }
            "mcp.register" => {
                let name = args.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                let config = args.get("config").cloned().unwrap_or(Value::Null);
                let extension_path = args
                    .get("extensionPath")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if let Some(session) = self.session() {
                    if let Ok(mut servers) = session.mcp_servers.write() {
                        servers.retain(|server| server.get("name").and_then(Value::as_str) != Some(&name));
                        servers.push(json!({
                            "name": name,
                            "config": config,
                            "extensionPath": extension_path,
                        }));
                        let servers = Value::Array(servers.clone());
                        rpi_extensions::emit_event(
                            "mcp_servers_change",
                            &json!({ "type": "mcp_servers_change", "servers": servers }),
                        );
                    }
                }
                Ok(Value::Null)
            }
            "mcp.unregister" => {
                let name = args.get("name").and_then(Value::as_str).unwrap_or("");
                if let Some(session) = self.session() {
                    if let Ok(mut servers) = session.mcp_servers.write() {
                        servers.retain(|server| server.get("name").and_then(Value::as_str) != Some(name));
                    }
                }
                Ok(Value::Null)
            }
            "mcp.list" => Ok(self
                .session()
                .map(|session| {
                    session
                        .mcp_servers
                        .read()
                        .map(|servers| Value::Array(servers.clone()))
                        .unwrap_or(Value::Array(Vec::new()))
                })
                .unwrap_or(Value::Array(Vec::new()))),
            "models.list" | "models.listAvailable" => self.action(|host| {
                Box::pin(async move { host.list_models(json!({})).await })
            }),
            "models.find" => {
                let provider = args
                    .get("provider")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let model_id = args
                    .get("modelId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.action(move |host| {
                    let provider = provider.clone();
                    let model_id = model_id.clone();
                    Box::pin(async move {
                        let models = host.list_models(json!({})).await?;
                        let found = models
                            .as_array()
                            .and_then(|models| {
                                models.iter().find(|model| {
                                    model.get("provider").and_then(Value::as_str)
                                        == Some(provider.as_str())
                                        && model.get("id").and_then(Value::as_str)
                                            == Some(model_id.as_str())
                                })
                            })
                            .cloned()
                            .unwrap_or(Value::Null);
                        Ok(found)
                    })
                })
            }
            "models.hasConfiguredAuth" => Ok(json!(false)),
            "models.getProviderAuthStatus" => Ok(json!("unknown")),
            "models.getProvider" => Ok(Value::Null),
            "models.getProviderDisplayName" => Ok(Value::Null),
            "models.isUsingOAuth" => Ok(json!(false)),
            "models.getRegisteredProviderIds" => Ok(self
                .session()
                .map(|session| {
                    session
                        .providers
                        .read()
                        .map(|providers| {
                            Value::Array(
                                providers
                                    .keys()
                                    .map(|name| Value::String(name.clone()))
                                    .collect(),
                            )
                        })
                        .unwrap_or(Value::Array(Vec::new()))
                })
                .unwrap_or(Value::Array(Vec::new()))),
            "models.refresh" | "models.getError" => Ok(Value::Null),
            other => rpi_js::Host::call(&rpi_js::ProcessHost::new(), other, args),
        }
    }
}

impl JsHost {
    /// The commands the extensions registered.
    fn extension_commands(&self) -> Vec<JsCommand> {
        self.state
            .commands
            .lock()
            .map(|commands| commands.clone())
            .unwrap_or_default()
    }

    /// The live session, when the TUI installed one.
    fn session(&self) -> Option<Arc<JsSession>> {
        self.state.session.lock().ok().and_then(|slot| slot.clone())
    }

    /// Drive one harness-backed operation and wait for its answer.
    ///
    /// The host answers on the V8 thread, which is not a runtime thread, so
    /// the operation is spawned on the session's runtime and the thread parks
    /// on the reply — the same pattern the native plugin bridge uses.
    fn action(
        &self,
        call: impl FnOnce(Arc<dyn rpi_extensions::RuntimeActionHost>) -> futures::future::BoxFuture<'static, Result<Value, String>>
            + Send
            + 'static,
    ) -> Result<Value, String> {
        let session = self
            .session()
            .ok_or_else(|| "the session is not up yet".to_string())?;
        let host = session
            .actions
            .clone()
            .ok_or_else(|| "the session has no action host".to_string())?;
        let runtime = session
            .runtime
            .clone()
            .ok_or_else(|| "the session has no runtime".to_string())?;
        let (reply, answers) = std::sync::mpsc::sync_channel(1);
        runtime.spawn(async move {
            let result = call(host).await;
            let _ = reply.send(result);
        });
        answers
            .recv_timeout(std::time::Duration::from_secs(600))
            .map_err(|_| "the host operation did not answer".to_string())?
    }

    /// Set the working message, or hide the working indicator.
    fn set_working(&self, message: Option<&str>) {
        let Some(session) = self.session() else { return };
        let Some(set_working) = session.set_working.clone() else {
            return;
        };
        set_working(message.map(str::to_string));
    }

    /// Open a question for the user and hand back its request id.
    ///
    /// The call returns at once, like the original's open/poll/cancel
    /// protocol: the extension waits by polling, and the TUI presents the
    /// dialog on its own thread. Blocking here would freeze the TUI, because
    /// the TUI is the thread that presents the dialog.
    fn dialog(&self, kind: &str, args: &Value) -> Result<Value, String> {
        let session = self
            .session()
            .ok_or_else(|| "the session is not up yet".to_string())?;
        let mailbox = session
            .ui_dialog
            .clone()
            .ok_or_else(|| "the dialog needs an interactive UI".to_string())?;
        let title = args.get("title").and_then(Value::as_str).unwrap_or("");
        let message = args.get("message").and_then(Value::as_str).unwrap_or("");
        let mut ui = serde_json::Map::new();
        ui.insert("kind".into(), Value::String(kind.to_string()));
        ui.insert("question".into(), Value::String(title.to_string()));
        if !message.is_empty() {
            ui.insert("context".into(), Value::String(message.to_string()));
        }
        if let Some(options) = args.get("options").and_then(Value::as_array) {
            ui.insert(
                "options".into(),
                Value::Array(
                    options
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|option| json!({ "title": option }))
                        .collect(),
                ),
            );
        }
        if let Some(placeholder) = args.get("placeholder").and_then(Value::as_str) {
            ui.insert("placeholder".into(), Value::String(placeholder.to_string()));
        }
        if let Some(prefill) = args.get("prefill").and_then(Value::as_str) {
            ui.insert("prefill".into(), Value::String(prefill.to_string()));
        }
        let request_id = format!("js-dialog-{}", next_dialog_id());
        rpi_extensions::emit_event(
            "ui_prompt_start",
            &json!({
                "type": "ui_prompt_start",
                "reason": "ui_prompt",
                "kind": kind,
                "title": title,
            }),
        );
        let opened = mailbox.handle(json!({
            "op": "open",
            "requestId": request_id,
            "ui": Value::Object(ui),
        }))?;
        if opened.get("status").and_then(Value::as_str) != Some("pending") {
            rpi_extensions::emit_event(
                "ui_prompt_end",
                &json!({
                    "type": "ui_prompt_end",
                    "reason": "ui_prompt",
                    "kind": kind,
                    "title": title,
                }),
            );
            return Ok(Value::Null);
        }
        Ok(json!({ "requestId": request_id }))
    }

    /// The answer to an open dialog, or `null` while the user has not
    /// answered yet.
    fn poll_dialog(&self, args: &Value) -> Result<Value, String> {
        let kind = args.get("kind").and_then(Value::as_str).unwrap_or("selector");
        let session = self
            .session()
            .ok_or_else(|| "the session is not up yet".to_string())?;
        let mailbox = session
            .ui_dialog
            .clone()
            .ok_or_else(|| "the dialog needs an interactive UI".to_string())?;
        let request_id = args
            .get("requestId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let answer = mailbox.handle(json!({ "op": "poll", "requestId": request_id }))?;
        match answer.get("status").and_then(Value::as_str) {
            Some("answered") => {
                let payload = answer.get("answer").cloned().unwrap_or(Value::Null);
                rpi_extensions::emit_event(
                    "ui_prompt_end",
                    &json!({ "type": "ui_prompt_end", "reason": "ui_prompt" }),
                );
                Ok(json!({
                    "answered": true,
                    "value": dialog_answer(kind, payload),
                }))
            }
            Some("cancelled") => {
                rpi_extensions::emit_event(
                    "ui_prompt_end",
                    &json!({ "type": "ui_prompt_end", "reason": "ui_prompt" }),
                );
                Ok(Value::Null)
            }
            _ => Ok(json!({ "answered": false })),
        }
    }

    fn notify(&self, args: &Value) {
        let message = args.get("message").and_then(Value::as_str).unwrap_or("");
        if message.is_empty() {
            return;
        }
        let kind = args.get("type").and_then(Value::as_str).unwrap_or("info");
        let chat = self.state.chat.lock().ok().and_then(|chat| chat.clone());
        let Some(chat) = chat else { return };
        match kind {
            "error" => {
                chat.add_child(Arc::new(rpi_tui::Text::new(format!("  {}", message), 1, 0)));
            }
            _ => {
                chat.add_child(Arc::new(rpi_tui::Spacer::new(1)));
                chat.add_child(Arc::new(rpi_tui::Text::new(message.to_string(), 1, 0)));
            }
        }
        self.request_render();
    }

    fn set_widget(&self, args: &Value) {
        let key = args
            .get("key")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let placement = args
            .get("placement")
            .and_then(Value::as_str)
            .unwrap_or("aboveEditor")
            .to_string();
        let component = component_of(args);
        let Some(component) = component else {
            if let Ok(mut widgets) = self.state.widgets.lock() {
                widgets.retain(|widget| widget.key != key);
            }
            self.request_render();
            return;
        };
        if let Ok(mut widgets) = self.state.widgets.lock() {
            widgets.retain(|widget| widget.key != key);
            widgets.push(JsWidget {
                key,
                placement,
                component,
            });
        }
        self.request_render();
    }

    fn request_render(&self) {
        let hook = self
            .state
            .render
            .lock()
            .ok()
            .and_then(|render| render.clone());
        if let Some(hook) = hook {
            hook();
        }
    }
}

thread_local! {
    /// True while the host is answering a call from the extension.
    ///
    /// The extension runs on the runtime's own thread, so an event published
    /// from inside a host call cannot be handed to the extensions straight
    /// away: they are the thread that is making the call.
    static IN_HOST_CALL: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Whether the host is answering a call from the extension right now.
pub fn in_host_call() -> bool {
    IN_HOST_CALL.with(|flag| flag.get())
}

/// The themes the session offers.
///
/// The port has three presets; the original has a "system" entry and two
/// files. The list is what the two operations answer, so the port's list is
/// what they return, in the original's shape.
fn theme_list() -> Value {
    json!([
        { "name": "dark", "path": Value::Null },
        { "name": "light", "path": Value::Null },
        { "name": "monochrome", "path": Value::Null },
    ])
}

/// The next dialog request id. The ids only have to be unique per session.
fn next_dialog_id() -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
}

/// The answer a dialog returns to the extension.
///
/// The TUI answers with `{"values": [...], "value": ...}`; the original's
/// `select` returns the chosen string, `confirm` a boolean, and `input` and
/// `editor` the text (or nothing when the user cancelled).
fn dialog_answer(kind: &str, answer: Value) -> Value {
    let text = answer
        .get("value")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            answer
                .get("values")
                .and_then(Value::as_array)
                .and_then(|values| values.first())
                .and_then(Value::as_str)
                .map(str::to_string)
        });
    match kind {
        "confirm" => Value::Bool(match text.as_deref() {
            Some("Yes") | Some("yes") | Some("true") | Some("allow") => true,
            _ => answer.as_bool().unwrap_or(false),
        }),
        "selector" => text.map(Value::String).unwrap_or(Value::Null),
        _ => text.map(Value::String).unwrap_or(Value::Null),
    }
}

/// The component an operation carries: plain lines or a component the host
/// renders through the extension host.
fn component_of(args: &Value) -> Option<JsComponent> {
    if let Some(lines) = args.get("lines").and_then(Value::as_array) {
        return Some(JsComponent::Lines(
            lines
                .iter()
                .map(|line| line.as_str().unwrap_or_default().to_string())
                .collect(),
        ));
    }
    let id = args.get("component").and_then(Value::as_str)?;
    Some(JsComponent::Component(id.to_string()))
}

/// Whether a path names a JavaScript extension rather than a native plugin.
pub fn is_javascript_extension(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("ts") | Some("js") | Some("mts") | Some("mjs")
    )
}

/// The extension files in a directory.
///
/// Mirrors pi's discovery: the `*.ts` and `*.js` files of the directory, and
/// the entry point of every subdirectory that has one.
pub fn discover_in_dir(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<(String, bool)> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.path().is_dir();
            Some((name, is_dir))
        })
        .collect();
    names.sort();
    let mut found = Vec::new();
    for (name, is_dir) in names {
        let path = dir.join(&name);
        if is_dir {
            found.extend(resolve_entries(&path));
            continue;
        }
        if name.ends_with(".ts") || name.ends_with(".js") {
            found.push(path);
        }
    }
    found
}

/// The entry points of an extension directory.
fn resolve_entries(dir: &Path) -> Vec<PathBuf> {
    let manifest = dir.join("package.json");
    if manifest.exists() {
        if let Ok(text) = std::fs::read_to_string(&manifest) {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                let declared = value
                    .get("pi")
                    .and_then(|pi| pi.get("extensions"))
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let entries: Vec<PathBuf> = declared
                    .iter()
                    .filter_map(|entry| entry.as_str())
                    .map(|entry| dir.join(entry))
                    .filter(|entry| entry.exists())
                    .collect();
                if !entries.is_empty() {
                    return entries;
                }
            }
        }
    }
    for name in ["index.ts", "index.js"] {
        let candidate = dir.join(name);
        if candidate.exists() {
            return vec![candidate];
        }
    }
    Vec::new()
}

/// The extension files pi loads for a session.
///
/// The project directory comes first, then the agent directory, then the paths
/// the user named.
pub fn discover_extension_paths(
    cwd: &Path,
    agent_dir: &Path,
    explicit: &[PathBuf],
) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = Vec::new();
    let mut seen: Vec<PathBuf> = Vec::new();
    let add = |paths: Vec<PathBuf>, found: &mut Vec<PathBuf>, seen: &mut Vec<PathBuf>| {
        for path in paths {
            let resolved = path.canonicalize().unwrap_or_else(|_| path.clone());
            if seen.contains(&resolved) {
                continue;
            }
            seen.push(resolved);
            found.push(path);
        }
    };
    add(
        discover_in_dir(&cwd.join(CONFIG_DIR_NAME).join("extensions")),
        &mut found,
        &mut seen,
    );
    add(
        discover_in_dir(&agent_dir.join("extensions")),
        &mut found,
        &mut seen,
    );
    for path in explicit {
        if path.is_dir() {
            let entries = resolve_entries(path);
            if !entries.is_empty() {
                add(entries, &mut found, &mut seen);
                continue;
            }
            add(discover_in_dir(path), &mut found, &mut seen);
            continue;
        }
        add(vec![path.clone()], &mut found, &mut seen);
    }
    found
}
