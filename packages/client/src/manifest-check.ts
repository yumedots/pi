/**
 * The check of the manifest.
 *
 * The server loads the extensions; the client renders with them. The two sides have to
 * agree: an extension the server declares for the client has to be on the client, with the
 * same content, and an extension the client has for itself has to be known to the server.
 *
 * When they do not agree, the client does not start. A client that draws half of a
 * session is worse than a client that says what is missing.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { discoverClientExtensionPaths } from "./client-support/extension-discovery.ts";

/** The side of the split an extension belongs to. */
export type ExtensionSide = "client" | "server" | "both";

/** An extension, as the client knows it. */
export interface PiExtensionInfo {
	/** Where the extension file is. */
	readonly path: string;
	/**
	 * The side of the extension.
	 *
	 * The client does not load its own extensions, so it cannot ask them which side they
	 * declare: the side of a client extension is the one the client assumes.
	 */
	readonly side: ExtensionSide;
	/** The digest of the content of the file. */
	readonly hash: string;
}

/** The ways the two sides can differ. */
export type ExtensionMismatchKind = "server-only" | "client-only" | "hash-mismatch";

/** One difference between the extensions of the server and the ones of the client. */
export interface ExtensionMismatch {
	/** The kind of the difference. */
	readonly kind: ExtensionMismatchKind;
	/** The path of the extension. */
	readonly path: string;
	/** What the server has. */
	readonly server?: PiExtensionInfo;
	/** What the client has. */
	readonly client?: PiExtensionInfo;
}

/**
 * The digest of an extension file, as the manifest carries it.
 *
 * The digest is the sha256 of the content of the file, in hex, cut to its first twelve
 * characters. A file that cannot be read has no digest.
 */
export function extensionFileHash(filePath: string): string {
	try {
		return createHash("sha256").update(readFileSync(filePath)).digest("hex").slice(0, 12);
	} catch {
		return "";
	}
}

/**
 * Compare the extensions of the client with the ones of the server.
 *
 * The server owns the extensions it loads, so the client has to have the ones the server
 * declares for the client side, with the same content. The client owns the extensions it
 * installed for itself, so the server has to know them.
 *
 * The client does not load its own extensions, so it cannot ask them which side they
 * declare: the side of a client extension is the one the client assumes. That does not
 * matter here: the side only decides whether the server expects the client to have the
 * file. A file the client has and the server knows is not a difference, whatever side
 * the server gave it.
 */
export function compareExtensionSets(
	clientExtensions: readonly PiExtensionInfo[],
	serverExtensions: readonly PiExtensionInfo[],
): ExtensionMismatch[] {
	const mismatches: ExtensionMismatch[] = [];
	const clientByPath = new Map(clientExtensions.map((extension) => [extension.path, extension]));

	for (const server of serverExtensions) {
		if (server.side !== "client" && server.side !== "both") continue;
		const client = clientByPath.get(server.path);
		if (!client) {
			mismatches.push({ kind: "server-only", path: server.path, server });
			continue;
		}
		if (client.hash !== server.hash) {
			mismatches.push({ kind: "hash-mismatch", path: server.path, server, client });
		}
	}

	const serverPaths = new Set(serverExtensions.map((extension) => extension.path));
	for (const client of clientExtensions) {
		if (serverPaths.has(client.path)) continue;
		mismatches.push({ kind: "client-only", path: client.path, client });
	}

	return mismatches;
}

/**
 * The message the user reads when the two sides do not match.
 *
 * The message names the path, the side and the hash of every difference, on both sides,
 * so the user knows what to install and what to remove.
 */
export function formatExtensionMismatches(mismatches: readonly ExtensionMismatch[]): string {
	const lines = ["This client does not match the server.", ""];
	lines.push("The server has:");
	lines.push(...describeExtensions(mismatches, (mismatch) => mismatch.server, serverReason));
	lines.push("The client has:");
	lines.push(...describeExtensions(mismatches, (mismatch) => mismatch.client, clientReason));
	lines.push("");
	lines.push("Install the same extensions on both sides, or remove the ones that are not needed.");
	return lines.join("\n");
}

/**
 * The lines that describe the differences of one side.
 */
function describeExtensions(
	mismatches: readonly ExtensionMismatch[],
	pick: (mismatch: ExtensionMismatch) => PiExtensionInfo | undefined,
	reason: (mismatch: ExtensionMismatch) => string,
): string[] {
	const described = mismatches
		.map((mismatch) => ({ mismatch, extension: pick(mismatch) }))
		.filter(
			(entry): entry is { mismatch: ExtensionMismatch; extension: PiExtensionInfo } => entry.extension !== undefined,
		);
	if (described.length === 0) return ["  (nothing)"];
	return described.map(
		({ mismatch, extension }) =>
			`  ${extension.path} (${extension.side}, ${extension.hash || "no hash"}): ${reason(mismatch)}`,
	);
}

/**
 * Why the server has an extension the client does not have.
 */
function serverReason(mismatch: ExtensionMismatch): string {
	if (mismatch.kind === "hash-mismatch") return "the content differs from the copy of the client";
	return "the client does not have it";
}

/**
 * Why the client has an extension the server does not know.
 */
function clientReason(mismatch: ExtensionMismatch): string {
	if (mismatch.kind === "hash-mismatch") return "the content differs from the copy of the server";
	return "the server does not know it";
}

/**
 * The client refuses to start against a server it does not match.
 */
export class ManifestMismatchError extends Error {
	readonly mismatches: readonly ExtensionMismatch[];

	constructor(mismatches: readonly ExtensionMismatch[]) {
		super(formatExtensionMismatches(mismatches));
		this.name = "ManifestMismatchError";
		this.mismatches = mismatches;
	}
}

/**
 * The extension files the client has on disk.
 *
 * The client does not load the extensions: the server does that. It only has to
 * know which extension files sit on its own disk, so it can tell the server that
 * the two sides do not match.
 */
export function collectClientExtensions(options: {
	/** The working directory of the server. */
	cwd: string;
	/** The agent directory of the client. */
	agentDir: string;
	/** The extension paths of the settings of the server. */
	configuredPaths?: readonly string[];
}): PiExtensionInfo[] {
	return discoverClientExtensionPaths(options).map((path) => ({
		path,
		side: "client",
		hash: extensionFileHash(path),
	}));
}

/**
 * Check the extensions of the client against the manifest of the server.
 *
 * @throws {ManifestMismatchError} when the two sides do not match.
 */
export function assertManifestMatches(
	clientExtensions: readonly PiExtensionInfo[],
	manifest: { extensions: readonly PiExtensionInfo[] },
): void {
	const mismatches = compareExtensionSets(clientExtensions, manifest.extensions);
	if (mismatches.length > 0) throw new ManifestMismatchError(mismatches);
}
