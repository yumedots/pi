//! pi's own example extensions must load in the port's embedded host.
//!
//! The original ships 79 example extensions under
//! `packages/coding-agent/examples/extensions`. An extension written for pi
//! has to load on the port unchanged, so every one of them is loaded here and
//! the failures are named.
//!
//! The original's checkout is read only. The test finds it through
//! `PI_TS_ROOT` and falls back to the usual path; when the checkout is not
//! there the test has nothing to check and says so.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use rpi_js::{ProcessHost, Runtime};

/// The original's checkout.
fn original_root() -> PathBuf {
    PathBuf::from(
        std::env::var("PI_TS_ROOT").unwrap_or_else(|_| "/Users/gabriel/pi".to_string()),
    )
}

/// The directory the example extensions live in.
fn examples_dir() -> Option<PathBuf> {
    let dir = original_root()
        .join("packages")
        .join("coding-agent")
        .join("examples")
        .join("extensions");
    dir.is_dir().then_some(dir)
}

/// Every example extension: the single files and the directories with an entry
/// point. The same rule the parity harness uses.
fn example_entries(dir: &Path) -> Vec<(String, PathBuf)> {
    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    let mut names: Vec<_> = std::fs::read_dir(dir)
        .expect("the examples directory is readable")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    for name in names {
        let path = dir.join(&name);
        if path.is_dir() {
            for entry in ["index.ts", "index.js"] {
                let candidate = path.join(entry);
                if candidate.is_file() {
                    entries.push((format!("{name}/{entry}"), candidate));
                    break;
                }
            }
            continue;
        }
        if name.ends_with(".ts") || name.ends_with(".js") {
            entries.push((name, path));
        }
    }
    entries
}

#[test]
fn every_example_extension_loads_in_the_embedded_host() {
    let Some(dir) = examples_dir() else {
        eprintln!(
            "the original's checkout is not at {}: nothing to check",
            original_root().display()
        );
        return;
    };
    let entries = example_entries(&dir);
    assert_eq!(
        entries.len(),
        79,
        "the original ships 79 example extensions; the directory has {}",
        entries.len()
    );

    let host = Arc::new(ProcessHost::new());
    let mut runtime = Runtime::new(host).expect("the runtime starts");

    let mut failures: Vec<String> = Vec::new();
    for (name, path) in &entries {
        let source = std::fs::read_to_string(path)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        match runtime.load_extension(&path.to_string_lossy(), &source) {
            Ok(_) => {}
            Err(error) => failures.push(format!("{name}: {error}")),
        }
    }

    assert!(
        failures.is_empty(),
        "{} of {} example extensions do not load:\n{}",
        failures.len(),
        entries.len(),
        failures.join("\n")
    );
}
