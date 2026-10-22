/**
 * The pairing flow of the client.
 *
 * The opencode app pairs with the pi server through a QR code that carries the JSON
 * payload `{"code","urls"}`. Everything here runs against a stub: no server is started
 * and no socket is opened.
 */

import { describe, expect, test } from "vitest";
import { initTheme } from "../../coding-agent/src/core/theme/theme.ts";
import {
	buildConnectUrl,
	buildPairingPayload,
	formatPairingPayload,
	PairDialog,
	runPairingFlow,
} from "../src/pair-dialog.ts";

/** A fetch that answers the two routes the pairing flow uses. */
function stubFetch(
	code: string,
	urls: string[],
): {
	fetch: typeof globalThis.fetch;
	calls: Array<{ url: string; method: string }>;
} {
	const calls: Array<{ url: string; method: string }> = [];
	const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		calls.push({ url, method });
		if (url.endsWith("/api/pair")) {
			return new Response(JSON.stringify({ code, expires_in: 300 }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url.endsWith("/api/info")) {
			return new Response(JSON.stringify({ version: "1.3.0", pid: 42, urls, paths: {}, capabilities: {} }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return new Response("not found", { status: 404 });
	}) as unknown as typeof globalThis.fetch;
	return { fetch: fetchImpl, calls };
}

describe("the pairing payload", () => {
	test("carries the code and the addresses a device can reach", () => {
		const payload = buildPairingPayload("abc123", ["http://127.0.0.1:4096", "http://192.168.1.5:4096"]);
		expect(payload).toEqual({
			code: "abc123",
			urls: ["http://192.168.1.5:4096"],
		});
	});

	test("is the JSON the opencode app reads", () => {
		const payload = buildPairingPayload("abc123", ["http://192.168.1.5:4096"]);
		const parsed = JSON.parse(formatPairingPayload(payload)) as Record<string, unknown>;
		expect(Object.keys(parsed).sort()).toEqual(["code", "urls"]);
		expect(parsed.code).toBe("abc123");
		expect(parsed.urls).toEqual(["http://192.168.1.5:4096"]);
	});

	test("drops the duplicate addresses", () => {
		const payload = buildPairingPayload("abc123", [
			"http://192.168.1.5:4096",
			"http://192.168.1.5:4096",
			" http://10.0.0.2:4096 ",
		]);
		expect(payload.urls).toEqual(["http://192.168.1.5:4096", "http://10.0.0.2:4096"]);
	});

	test("builds the link that redeems the code", () => {
		expect(buildConnectUrl("http://127.0.0.1:4096", "abc123")).toBe("http://127.0.0.1:4096/auth/connect/abc123");
		expect(buildConnectUrl("http://127.0.0.1:4096/", "abc123")).toBe("http://127.0.0.1:4096/auth/connect/abc123");
	});
});

describe("the pairing flow", () => {
	test("asks the server for a code and builds the payload from its answer", async () => {
		const { fetch, calls } = stubFetch("code-42", ["http://127.0.0.1:4096", "http://192.168.1.5:4096"]);
		const flow = await runPairingFlow({ url: "http://127.0.0.1:4096", password: "secret", fetch });

		const pairCall = calls.find((call) => call.url.endsWith("/api/pair"));
		expect(pairCall).toBeDefined();
		expect(pairCall?.method).toBe("POST");
		expect(calls.some((call) => call.url.endsWith("/api/info"))).toBe(true);

		expect(flow.code).toBe("code-42");
		expect(flow.expiresIn).toBe(300);
		expect(flow.payload).toEqual({
			code: "code-42",
			urls: ["http://192.168.1.5:4096"],
		});
		const parsed = JSON.parse(flow.payloadText) as { code: string; urls: string[] };
		expect(parsed.code).toBe("code-42");
		expect(parsed.urls).toHaveLength(1);
		expect(flow.connectUrls).toEqual([
			"http://127.0.0.1:4096/auth/connect/code-42",
			"http://192.168.1.5:4096/auth/connect/code-42",
		]);
	});

	test("fails when the server hands out no code", async () => {
		const fetchImpl = (async () =>
			new Response(JSON.stringify({}), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as unknown as typeof globalThis.fetch;
		await expect(runPairingFlow({ url: "http://127.0.0.1:4096", fetch: fetchImpl })).rejects.toThrow(/pairing code/i);
	});
});

describe("the pairing dialog", () => {
	test("shows the code and the links", () => {
		initTheme("dark");
		const flow = {
			payload: buildPairingPayload("code-42", ["http://127.0.0.1:4096"]),
			payloadText: formatPairingPayload(buildPairingPayload("code-42", ["http://127.0.0.1:4096"])),
			code: "code-42",
			expiresIn: 300,
			urls: ["http://127.0.0.1:4096"],
			connectUrls: ["http://127.0.0.1:4096/auth/connect/code-42"],
		};
		const dialog = new PairDialog({
			payloadText: flow.payloadText,
			code: flow.code,
			connectUrls: flow.connectUrls,
		});
		const lines = dialog.render(100).join("\n");
		expect(lines).toContain("code-42");
		expect(lines).toContain("http://127.0.0.1:4096/auth/connect/code-42");
	});
});
