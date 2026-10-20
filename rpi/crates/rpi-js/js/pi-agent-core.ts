/**
 * The `@earendil-works/pi-agent-core` module the extensions import.
 *
 * The agent loop belongs to the host, so this module carries the names only.
 * An extension that drives an agent of its own needs the host's agent
 * runtime, which the port does not have yet.
 */

export const AGENT_RUNTIME_AVAILABLE = false;

export default { AGENT_RUNTIME_AVAILABLE };
