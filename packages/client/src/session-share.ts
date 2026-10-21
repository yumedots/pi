import { spawn, spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_RADIUS_GATEWAY } from "@earendil-works/pi-ai/providers/radius-config";
import { getAuthCredential } from "@earendil-works/pi-coding-agent/cli/auth-command";
import { getShareViewerUrl } from "@earendil-works/pi-coding-agent/config";
import { theme } from "@earendil-works/pi-coding-agent/core/theme/theme";
import { type Container, type EditorComponent, hyperlink, type TUI } from "@earendil-works/pi-tui";
import { BorderedLoader } from "./components/bordered-loader.ts";
import type { SessionFacade } from "./session-facade.ts";

interface SessionShareContext {
	session: SessionFacade;
	ui: TUI;
	editorContainer: Container;
	editor: EditorComponent;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
}

/** Trailing `pi.share` entry carrying the system prompt and tool schemas for the session viewer. */
export function createShareTrailingEntries(
	session: SessionFacade,
	parentId: string | null,
	timestamp: string,
): object[] {
	return [
		{
			type: "custom",
			customType: "pi.share",
			id: crypto.randomUUID().slice(0, 8),
			parentId,
			timestamp,
			data: {
				systemPrompt: session.systemPrompt,
				tools: session.tools.map((tool) => ({
					name: tool.name,
					...(tool.description !== undefined ? { description: tool.description } : {}),
					...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
				})),
			},
		},
	];
}

/**
 * Export the current branch with presentation metadata for Radius.
 *
 * The server owns the session file, so it writes the branch; the client appends the
 * trailing entry with the system prompt and the tool schemas it knows about.
 */
export async function exportSessionForShare(filePath: string, session: SessionFacade): Promise<void> {
	const exportedPath = await session.exportToJsonl(filePath);
	const target = exportedPath || filePath;
	const lines = fs
		.readFileSync(target, "utf-8")
		.split("\n")
		.filter((line) => line.trim().length > 0);
	const last = lines.length > 0 ? (JSON.parse(lines[lines.length - 1]!) as { type?: string; id?: string }) : undefined;
	const parentId = last && last.type !== "session" ? (last.id ?? null) : null;
	const trailing = createShareTrailingEntries(session, parentId, new Date().toISOString());
	fs.appendFileSync(target, `${trailing.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

/** Share the current session through Radius, falling back to a private gist. */
export async function shareSession(context: SessionShareContext): Promise<void> {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-share-"));
	const jsonlFile = path.join(tempDir, "session.jsonl");
	const htmlFile = path.join(tempDir, "session.html");

	try {
		try {
			await exportSessionForShare(jsonlFile, context.session);
		} catch (error: unknown) {
			context.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
			return;
		}
		const destination = context.session.settingsManager.getSessionShareDestination();
		if (destination !== "gist") {
			if (await tryShareViaRadius(jsonlFile, context)) return;
			if (destination === "radius") {
				context.showError("Radius authentication is not configured. Run '/login radius' first.");
				return;
			}
		}

		try {
			const authResult = spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
			if (authResult.status !== 0) {
				context.showError("GitHub CLI is not logged in. Run 'gh auth login' first.");
				return;
			}
		} catch {
			context.showError("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/");
			return;
		}

		try {
			await context.session.exportToHtml(htmlFile);
		} catch (error: unknown) {
			context.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
			return;
		}
		await shareViaGist(htmlFile, context);
	} finally {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}
}

async function tryShareViaRadius(tmpFile: string, context: SessionShareContext): Promise<boolean> {
	const provider = context.session.modelRuntime.getProvider("radius");
	if (!provider) return false;

	const token = getAuthCredential(
		await context.session.modelRuntime.getAuth("radius", { minOAuthValidityMs: 5 * 60_000 }),
	);
	if (!token) return false;

	const loader = new BorderedLoader(context.ui, theme, "Uploading to Radius...");
	context.editorContainer.clear();
	context.editorContainer.addChild(loader);
	context.ui.setFocus(loader);
	context.ui.requestRender();
	loader.onAbort = () => {
		restoreEditor(loader, context);
		context.showStatus("Share cancelled");
	};

	try {
		const body = fs.readFileSync(tmpFile);
		const url = new URL("/v1/artifacts", DEFAULT_RADIUS_GATEWAY);
		url.searchParams.set("visibility", "organization");
		url.searchParams.set("title", "Pi session");
		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/x-ndjson",
				"Content-Length": String(body.byteLength),
			},
			body,
			signal: loader.signal,
		});
		if (loader.signal.aborted) return true;
		const json = (await response.json().catch(() => null)) as {
			artifact?: { canonical_url: string };
			error?: string;
		} | null;
		if (loader.signal.aborted) return true;
		restoreEditor(loader, context);
		if (!response.ok || !json?.artifact) {
			context.showError(
				`Failed to upload Radius artifact: ${json?.error || response.statusText || response.status}`,
			);
			return true;
		}
		const shareUrl = json.artifact.canonical_url;
		context.showStatus(`Share URL: ${hyperlink(shareUrl, shareUrl)}`);
		return true;
	} catch (error: unknown) {
		if (!loader.signal.aborted) {
			restoreEditor(loader, context);
			context.showError(
				`Failed to upload Radius artifact: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
		return true;
	}
}

async function shareViaGist(tmpFile: string, context: SessionShareContext): Promise<void> {
	const loader = new BorderedLoader(context.ui, theme, "Creating gist...");
	context.editorContainer.clear();
	context.editorContainer.addChild(loader);
	context.ui.setFocus(loader);
	context.ui.requestRender();

	let proc: ReturnType<typeof spawn> | null = null;
	loader.onAbort = () => {
		proc?.kill();
		restoreEditor(loader, context);
		context.showStatus("Share cancelled");
	};

	try {
		const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
			proc = spawn("gh", ["gist", "create", "--public=false", tmpFile]);
			let stdout = "";
			let stderr = "";
			proc.stdout?.on("data", (data) => {
				stdout += data.toString();
			});
			proc.stderr?.on("data", (data) => {
				stderr += data.toString();
			});
			proc.on("close", (code) => resolve({ stdout, stderr, code }));
		});

		if (loader.signal.aborted) return;
		restoreEditor(loader, context);

		if (result.code !== 0) {
			context.showError(`Failed to create gist: ${result.stderr?.trim() || "Unknown error"}`);
			return;
		}

		const gistUrl = result.stdout?.trim();
		const gistId = gistUrl?.split("/").pop();
		if (!gistId) {
			context.showError("Failed to parse gist ID from gh output");
			return;
		}

		const previewUrl = getShareViewerUrl(gistId);
		context.showStatus(`Share URL: ${hyperlink(previewUrl, previewUrl)}\nGist: ${hyperlink(gistUrl, gistUrl)}`);
	} catch (error: unknown) {
		if (!loader.signal.aborted) {
			restoreEditor(loader, context);
			context.showError(`Failed to create gist: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}
}

function restoreEditor(loader: BorderedLoader, context: SessionShareContext): void {
	loader.dispose();
	context.editorContainer.clear();
	context.editorContainer.addChild(context.editor);
	context.ui.setFocus(context.editor);
}
