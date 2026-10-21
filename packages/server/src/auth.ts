/**
 * Server authentication.
 *
 * The opencode clients send HTTP Basic auth with the fixed username `opencode` and the
 * server password, or a pairing token issued by `POST /api/pair`. The server accepts both,
 * so a client can authenticate with the password it was started with or with a token it
 * obtained from a pairing code.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** The username the opencode clients use. */
export const BASIC_AUTH_USERNAME = "opencode";

/** How long a pairing code stays valid. */
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

/** The key derivation salt for session tokens. */
const SESSION_TOKEN_KEY = "pi-session-v1";

/** A pairing code with its expiry. */
export interface PairingCode {
	code: string;
	expiresAt: number;
}

/**
 * Check a Basic auth header against the server password.
 *
 * @returns `true` when the header carries the right credentials.
 */
export function verifyBasicAuth(header: string | undefined, password: string): boolean {
	if (!header) return false;
	const [scheme, encoded] = header.split(" ");
	if (scheme?.toLowerCase() !== "basic" || !encoded) return false;
	let decoded: string;
	try {
		decoded = Buffer.from(encoded, "base64").toString("utf8");
	} catch {
		return false;
	}
	const separator = decoded.indexOf(":");
	if (separator === -1) return false;
	const user = decoded.slice(0, separator);
	const given = decoded.slice(separator + 1);
	if (user !== BASIC_AUTH_USERNAME) return false;
	const givenBytes = Buffer.from(given);
	const expectedBytes = Buffer.from(password);
	if (givenBytes.length !== expectedBytes.length) return false;
	return timingSafeEqual(givenBytes, expectedBytes);
}

/**
 * Create a pairing code.
 */
export function createPairingCode(now: number = Date.now()): PairingCode {
	const code = randomBytes(16).toString("base64url");
	return { code, expiresAt: now + PAIRING_CODE_TTL_MS };
}

/**
 * The token format: `<expiresMs>.<hmac>`.
 */
export function createSessionToken(password: string, expiresAt: number): string {
	const signature = createHmac("sha256", password).update(`${SESSION_TOKEN_KEY}:${expiresAt}`).digest("base64url");
	return `${expiresAt}.${signature}`;
}

/**
 * Check a session token against the server password.
 *
 * @returns `true` when the token was issued by this server and has not expired.
 */
export function verifySessionToken(token: string, password: string, now: number = Date.now()): boolean {
	const separator = token.indexOf(".");
	if (separator === -1) return false;
	const expiresAt = Number(token.slice(0, separator));
	if (!Number.isFinite(expiresAt)) return false;
	if (expiresAt <= now) return false;
	const expected = createSessionToken(password, expiresAt);
	const given = Buffer.from(token);
	const wanted = Buffer.from(expected);
	if (given.length !== wanted.length) return false;
	return timingSafeEqual(given, wanted);
}

/**
 * Check any credential: the password itself or a pairing token.
 */
export function verifyCredential(credential: string, password: string, now: number = Date.now()): boolean {
	if (credential === password) return true;
	return verifySessionToken(credential, password, now);
}

/**
 * The `Authorization` header value for a credential.
 */
export function basicAuthHeader(credential: string): string {
	return `Basic ${Buffer.from(`${BASIC_AUTH_USERNAME}:${credential}`).toString("base64")}`;
}
