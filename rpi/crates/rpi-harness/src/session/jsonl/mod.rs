//! `session::jsonl` — the durable file `SessionStorage` + repo over the
//! original's session-file format.
//!
//! The file is the original's version 3 format: a `{"type":"session",
//! "version":3,…}` header line followed by the flat entry list.
//!
//! Submodules:
//! - [`errors`] — `JsonlDecodeError` + `file_result` / `invalid_file`.
//! - [`types`] — `SessionFileHeader`, `JsonlSessionMetadata`, repo options.
//! - [`codec`] — the header + entry line codec.
//! - [`storage`] — `JsonlSessionStorage` (torn-tail recovery + atomic publish).
//! - [`repo`] — `JsonlSessionRepo` (`SessionRepo` impl over JSONL files).

pub mod codec;
pub mod errors;
pub mod repo;
pub mod storage;
pub mod types;

pub use codec::{
    encode_entry, encode_header, metadata_from_header, parse_entry, parse_header,
};
pub use errors::{file_result, invalid_file, JsonlDecodeError, JsonlDecodeErrorKind};
pub use repo::JsonlSessionRepo;
pub use storage::JsonlSessionStorage;
pub use types::{
    JsonlSessionCreateOptions, JsonlSessionListOptions, JsonlSessionMetadata,
    JsonlSessionRepoOptions, JsonlSourceFormat, SessionFileHeader,
};
