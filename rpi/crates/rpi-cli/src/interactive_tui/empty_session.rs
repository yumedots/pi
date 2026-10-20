//! The empty-session screen: the greeting above the centred input box.
//!
//! Mirrors upstream's `emptySessionGreeting` (`interactive-mode.ts:914-919`).

/// The greeting above the input box.
pub(super) fn greeting() -> String {
    greeting_for(&username())
}

/// The greeting for a user name. An empty name greets "there".
pub(super) fn greeting_for(username: &str) -> String {
    let name = if username.is_empty() {
        "there".to_string()
    } else {
        capitalize(username)
    };
    format!("Hi {name}, what are we building today?")
}

/// The current user's name, empty when the environment does not name one.
fn username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("LOGNAME"))
        .unwrap_or_default()
}

/// The name with its first letter capitalised.
fn capitalize(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_greeting_names_the_user() {
        assert_eq!(
            greeting_for("gabriel"),
            "Hi Gabriel, what are we building today?"
        );
    }

    #[test]
    fn the_greeting_falls_back_to_there() {
        assert_eq!(greeting_for(""), "Hi there, what are we building today?");
    }

    #[test]
    fn the_first_letter_is_capitalised() {
        assert_eq!(
            greeting_for("alice"),
            "Hi Alice, what are we building today?"
        );
    }
}
