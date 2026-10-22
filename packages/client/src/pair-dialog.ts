/**
 * The pairing dialog.
 *
 * The pi server hands out a single-use pairing code. The opencode app reads the code
 * from a QR code that carries the JSON payload `{"code","urls"}`: the code and every
 * address the server can be reached at. The app redeems the code with
 * `GET /auth/connect/{code}` and gets a session token.
 *
 * This module builds that payload, asks the server for a code and renders the dialog
 * the `/pair` command opens.
 */

import { theme } from "@earendil-works/pi-coding-agent/core/theme/theme";
import { basicAuthHeader } from "@earendil-works/pi-server/client";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { renderQr } from "./qr.ts";

/** The payload the opencode app reads from the QR code. */
export interface PairingPayload {
	/** The single-use pairing code. */
	code: string;
	/** The addresses the server can be reached at. */
	urls: string[];
}

/** The options of the pairing requests. */
export interface PairingRequestOptions {
	/** The base URL of the server. */
	url: string;
	/** The password of the server, when the route needs it. */
	password?: string;
	/** The fetch implementation. Defaults to the global one. */
	fetch?: typeof globalThis.fetch;
}

/** What a pairing run produced. */
export interface PairingFlow {
	/** The payload the QR code carries. */
	payload: PairingPayload;
	/** The payload as the JSON the QR code carries. */
	payloadText: string;
	/** The pairing code. */
	code: string;
	/** How long the code is valid, in seconds. */
	expiresIn: number;
	/** The addresses the server can be reached at. */
	urls: string[];
	/** The links that redeem the code. */
	connectUrls: string[];
}

/**
 * Whether an address is a loopback address.
 */
export function isLoopbackUrl(url: string): boolean {
	try {
		const hostname = new URL(url).hostname;
		return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
	} catch {
		return false;
	}
}

/**
 * Build the payload the opencode app reads.
 *
 * The QR code carries the addresses a scanning device can reach: a loopback address is
 * useless to a phone, so it is left out of the payload. The links that redeem the code are
 * built from every address, because the machine the server runs on can use the loopback one.
 */
export function buildPairingPayload(code: string, urls: readonly string[]): PairingPayload {
	const unique: string[] = [];
	for (const url of urls) {
		const trimmed = url.trim();
		if (!trimmed) continue;
		if (unique.includes(trimmed)) continue;
		unique.push(trimmed);
	}
	return { code, urls: unique.filter((url) => !isLoopbackUrl(url)) };
}

/**
 * The JSON the QR code carries.
 *
 * The opencode app decodes the QR code as JSON with the fields `code` and `urls`.
 */
export function formatPairingPayload(payload: PairingPayload): string {
	return JSON.stringify({ code: payload.code, urls: payload.urls });
}

/**
 * The link that redeems a pairing code.
 */
export function buildConnectUrl(baseUrl: string, code: string): string {
	return `${baseUrl.replace(/\/$/, "")}/auth/connect/${code}`;
}

/**
 * Ask the server for a pairing code.
 */
export async function requestPairingCode(options: PairingRequestOptions): Promise<{ code: string; expiresIn: number }> {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const headers: Record<string, string> = {};
	if (options.password) headers.authorization = basicAuthHeader(options.password);
	const response = await fetchImpl(`${options.url.replace(/\/$/, "")}/api/pair`, {
		method: "POST",
		headers,
	});
	if (!response.ok) {
		throw new Error(`The server refused to hand out a pairing code (${response.status}).`);
	}
	const body = (await response.json()) as { code?: string; expires_in?: number };
	if (!body.code) {
		throw new Error("The server did not hand out a pairing code.");
	}
	return { code: body.code, expiresIn: body.expires_in ?? 300 };
}

/**
 * The addresses the server can be reached at.
 */
export async function fetchServerUrls(options: PairingRequestOptions): Promise<string[]> {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const headers: Record<string, string> = {};
	if (options.password) headers.authorization = basicAuthHeader(options.password);
	const response = await fetchImpl(`${options.url.replace(/\/$/, "")}/api/info`, { headers });
	if (!response.ok) {
		throw new Error(`The server did not answer with its addresses (${response.status}).`);
	}
	const body = (await response.json()) as { urls?: string[] };
	return body.urls ?? [];
}

/**
 * Run the pairing flow: ask for a code, collect the addresses and build the payload.
 */
export async function runPairingFlow(options: PairingRequestOptions): Promise<PairingFlow> {
	const { code, expiresIn } = await requestPairingCode(options);
	const urls = await fetchServerUrls(options);
	const payload = buildPairingPayload(code, urls);
	// Every address redeems the code; only the reachable ones go into the QR code.
	const unique: string[] = [];
	for (const url of urls) {
		const trimmed = url.trim();
		if (!trimmed || unique.includes(trimmed)) continue;
		unique.push(trimmed);
	}
	const connectUrls = unique.map((url) => buildConnectUrl(url, code));
	return {
		payload,
		payloadText: formatPairingPayload(payload),
		code,
		expiresIn,
		urls: unique,
		connectUrls,
	};
}

/** The options of {@link PairDialog}. */
export interface PairDialogOptions {
	/** The payload the QR code carries. */
	payloadText: string;
	/** The pairing code, shown next to the QR code. */
	code: string;
	/** How long the code is valid, in seconds. */
	expiresIn?: number;
	/** The links that redeem the code. */
	connectUrls: readonly string[];
	/** Whether a device on the network can reach the server. */
	reachable?: boolean;
}

/**
 * The dialog the `/pair` command opens.
 *
 * It shows the QR code of the pairing payload, the code itself and the links that
 * redeem it, so the user can also type the code by hand. The heading of the
 * command belongs to the caller, so the dialog starts with its explanation.
 */
export class PairDialog implements Component {
	private readonly options: PairDialogOptions;

	constructor(options: PairDialogOptions) {
		this.options = options;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		if (this.options.expiresIn !== undefined) {
			const minutes = Math.max(1, Math.round(this.options.expiresIn / 60));
			lines.push(
				theme.fg(
					"dim",
					`Open a link to connect. Links work once and expire in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
				),
			);
		}
		lines.push(theme.fg("dim", "Scan the code with the opencode app, or open one of the links below."));
		lines.push("");

		let qrLines: string[] = [];
		try {
			qrLines = renderQr(this.options.payloadText, { ecLevel: "M", quietZone: 2 });
		} catch {
			qrLines = [];
		}
		for (const line of qrLines) {
			// The QR code is not truncated: a cut-off code cannot be scanned.
			lines.push(theme.fg("accent", line));
		}
		if (qrLines.length === 0) {
			lines.push(theme.fg("warning", "The pairing code could not be rendered as a QR code."));
		}
		if (this.options.reachable === false) {
			lines.push(
				theme.fg(
					"warning",
					"The server only listens on the loopback address, so a device on the network cannot reach it.",
				),
			);
			lines.push(theme.fg("dim", "Start the server with --hostname 0.0.0.0 to pair a phone."));
		}
		lines.push("");

		lines.push(`${theme.fg("muted", "Code:")} ${theme.bold(this.options.code)}`);
		if (this.options.expiresIn !== undefined) {
			const minutes = Math.max(1, Math.round(this.options.expiresIn / 60));
			lines.push(theme.fg("dim", `The code is valid for ${minutes} minute${minutes === 1 ? "" : "s"}.`));
		}
		for (const url of this.options.connectUrls) {
			lines.push(truncateToWidth(theme.fg("accent", url), width));
		}
		return lines;
	}

	invalidate(): void {}
}
