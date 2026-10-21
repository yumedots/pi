//! The request prefix of a conversation must not change between its turns.
//!
//! Every provider request of a turn carries the whole conversation, and the
//! provider's prompt cache keys on the bytes that come before the newest user
//! message. Those bytes are the system prompt, the tool declarations and the
//! exchange so far: all of them are the same in every turn of one
//! conversation, and they must stay that way. A timestamp, a re-serialized
//! map, a re-ordered tool list or a per-turn reminder in the system prompt
//! would change one byte of the prefix and make the provider read the whole
//! prompt again on every turn.
//!
//! The test runs two turns of one conversation through the agent loop and
//! compares the contexts the provider was handed: the messages of turn 1 must
//! be a byte-prefix of the messages of turn 2, so everything before the newest
//! user message is byte-identical.

#[path = "common/mod.rs"]
mod common;

use std::sync::{Arc, Mutex};

use common::{assistant_text, base_config, user_message};
use rpi_agent::{run_agent_loop, stream_fn, AgentContext, CollectorEmitter};
use rpi_ai::event_stream::create_assistant_message_event_stream;
use rpi_ai::types::{AssistantMessageEvent, Context, DoneReason, StopReason};

/// A stream fn that records the context of every provider call and answers
/// with a fixed text.
fn recording_stream_fn(recorded: Arc<Mutex<Vec<Context>>>) -> rpi_agent::StreamFn {
    stream_fn(move |_model, ctx, _opts| {
        recorded
            .lock()
            .expect("the recording lock")
            .push(ctx.clone());
        let (mut producer, stream) = create_assistant_message_event_stream();
        let message = assistant_text("ok", StopReason::Stop);
        let partial = Arc::new(message.clone());
        producer.push(AssistantMessageEvent::Start { partial });
        producer.push(AssistantMessageEvent::Done {
            reason: DoneReason::Stop,
            message,
        });
        stream
    })
}

#[tokio::test]
async fn the_provider_context_of_the_second_turn_starts_with_the_first() {
    let recorded = Arc::new(Mutex::new(Vec::new()));
    let stream = recording_stream_fn(Arc::clone(&recorded));
    let config = base_config();
    let (emitter, _events) = CollectorEmitter::new();

    let context = AgentContext {
        system_prompt: "system prompt".into(),
        messages: vec![],
        tools: vec![],
    };

    let first_new = run_agent_loop(
        vec![user_message("hello")],
        context.clone(),
        config.clone(),
        Arc::new(emitter),
        Arc::clone(&stream),
    )
    .await
    .expect("the first turn runs");

    // The second turn of the same conversation: the history of the first turn
    // plus a new user message.
    let mut second_context = context.clone();
    second_context.messages.extend(first_new.iter().cloned());
    let (emitter, _events) = CollectorEmitter::new();
    run_agent_loop(
        vec![user_message("again")],
        second_context,
        config,
        Arc::new(emitter),
        stream,
    )
    .await
    .expect("the second turn runs");

    let recorded = recorded.lock().expect("the recording lock").clone();
    assert_eq!(recorded.len(), 2, "one provider request per turn");
    let first = &recorded[0];
    let second = &recorded[1];

    assert_eq!(
        first.system_prompt, second.system_prompt,
        "the system prompt must be byte-identical across the turns"
    );
    assert_eq!(
        first.tools, second.tools,
        "the tool declarations must be byte-identical across the turns"
    );

    let first_messages =
        serde_json::to_string(&first.messages).expect("the messages of the first turn");
    let second_messages =
        serde_json::to_string(&second.messages).expect("the messages of the second turn");
    assert!(
        second_messages.starts_with(first_messages.trim_end_matches(']')),
        "the bytes before the newest user message must be identical across the turns:\n\
         turn 1: {first_messages}\nturn 2: {second_messages}"
    );
}
