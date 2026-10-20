//! The embedded JavaScript engine.
//!
//! The engine is created when the first extension needs it, so a session with
//! no JavaScript extension never pays for it.
//!
//! The host and the JavaScript exchange JSON. The host calls into JavaScript
//! with [`Runtime::call`] and the JavaScript calls into the host with the
//! `__piHostCall` operation, which the runtime installs on the global object.
//!
//! The extension host itself is pi's own TypeScript, bundled into one script
//! by `scripts/build-extension-host-bundle.mjs` and embedded here.

mod host;
mod runtime;
mod transpile;

pub use host::{Host, ProcessHost};
pub use runtime::{Error, Runtime};
pub use transpile::transpile;
