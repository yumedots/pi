/**
 * The error of a credential change that could not be synchronized.
 *
 * It lives in a module of its own so that a client can recognize it without loading the
 * model runtime and with it the static model catalog.
 */

export type CredentialSynchronizationOperation = "login" | "logout" | "setRuntimeApiKey" | "removeRuntimeApiKey";

/** Credentials changed successfully, but the local model/auth snapshot could not be synchronized. */
export class CredentialSynchronizationError extends Error {
	readonly providerId: string;
	readonly operation: CredentialSynchronizationOperation;
	readonly credential: unknown;

	constructor(
		providerId: string,
		operation: CredentialSynchronizationOperation,
		credential: unknown,
		options: ErrorOptions,
	) {
		super(`Credential ${operation} committed for ${providerId}, but local synchronization failed`, options);
		this.name = "CredentialSynchronizationError";
		this.providerId = providerId;
		this.operation = operation;
		this.credential = credential;
	}
}
