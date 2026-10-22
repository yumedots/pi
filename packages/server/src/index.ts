/**
 * The pi server package.
 *
 * The server hosts the agent runtime and speaks the opencode HTTP subset plus the pi
 * native routes.
 */

export {
	BASIC_AUTH_USERNAME,
	basicAuthHeader,
	createPairingCode,
	createSessionToken,
	issueSessionToken,
	PAIRING_CODE_TTL_MS,
	SESSION_TOKEN_TTL_MS,
	type PairingCode,
	verifyBasicAuth,
	verifyCredential,
	verifySessionToken,
} from "./auth.ts";
export { EventFeed, type FeedEvent, type FeedSubscription, SUBSCRIBER_OVERFLOW_ERROR } from "./events.ts";
export { type RouteContext, type RouteHandler, type RouteParams, Router, sendError, sendJson } from "./http/router.ts";
export { openSse, SSE_HEARTBEAT, type SseConnection, sseFrame } from "./http/sse.ts";
export {
	clearRegistration,
	REGISTRATION_FILE_NAME,
	readRegistration,
	registrationPath,
	type ServerRegistration,
	writeRegistration,
} from "./registration.ts";
export { type PiServer, type PiServerOptions, startServer } from "./server.ts";
export type { ServerContext } from "./server-context.ts";
export {
	ProjectNotTrustedError,
	type ServerInfo,
	type ServerSession,
	SessionRegistry,
	type SessionRegistryDeps,
} from "./session-registry.ts";
export { toSessionStateSnapshot } from "./state.ts";
export type {
	PiServerInfo,
	SessionQueueState,
	SessionResourcesSnapshot,
	SessionStateSnapshot,
} from "./types.ts";
