import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAuthCredential } from "@earendil-works/pi-coding-agent/cli/auth-command";
import {
	BUG_REPORT_CUSTOM_ENTRY_TYPE,
	type BugReportBundle,
	type BugReportSessionEntryData,
	bugReportArchiveFileName,
	collectBugReportDiagnostics,
	collectBugReportMetadata,
	writeBugReportArchive,
} from "@earendil-works/pi-coding-agent/core/bug-report";
import { uploadBugReport } from "@earendil-works/pi-coding-agent/core/bug-report-upload";
import { clearCrashLog, readCrashLog } from "@earendil-works/pi-coding-agent/core/crash-log";
import type { Extension } from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent/core/keybindings";
import { getRadiusGatewayUrl, RADIUS_PROVIDER_ID } from "@earendil-works/pi-coding-agent/core/radius";
import type { ReadonlySessionManager } from "@earendil-works/pi-coding-agent/core/session-manager";
import { theme } from "@earendil-works/pi-coding-agent/core/theme/theme";
import type { Container, EditorComponent, TUI } from "@earendil-works/pi-tui";
import { BorderedLoader } from "./components/bordered-loader.ts";
import { ExtensionEditorComponent } from "./components/extension-editor.ts";
import { ExtensionSelectorComponent } from "./components/extension-selector.ts";
import type { SessionFacade } from "./session-facade.ts";
import { exportSessionForShare } from "./session-share.ts";

interface BugReportContext {
	session: SessionFacade;
	ui: TUI;
	editorContainer: Container;
	editor: EditorComponent;
	keybindings: KeybindingsManager;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
}

interface BugReportOptions {
	hint?: string;
	includeSession: boolean;
	includeSummary: boolean;
	delivery: "upload" | "zip";
}

type Overlay = Container & { dispose?: () => void };

const DISCLAIMER =
	"This report goes to the Pi developers (Earendil) and is not shared publicly. It includes your pi version, operating system, the current model and provider configuration (without API keys), loaded extensions, settings, and provider error diagnostics from this session.";
const TRANSCRIPT_NOTE =
	"The transcript contains your messages, model output, tool calls and their results, including file contents and command output read during this session.";

/** Run the `/bug` flow: consent, optional summary, then upload or export. */
export async function reportBug(context: BugReportContext, initialHint?: string): Promise<void> {
	const options = await promptForOptions(context, initialHint);
	if (!options) {
		context.showStatus("Bug report cancelled");
		return;
	}
	if (options.delivery === "upload" && process.env.PI_OFFLINE) {
		context.showError("Uploading bug reports requires online mode. Use Export as Zip instead.");
		return;
	}

	let summary: string | undefined;
	if (options.includeSummary) {
		const loader = showLoader(
			context,
			`Writing summary with ${context.session.model?.name ?? "the current model"}...`,
		);
		try {
			summary = await context.session.summarizeForBugReport(options.hint);
		} catch (error: unknown) {
			restoreEditor(context, loader);
			if (loader.signal.aborted) context.showStatus("Bug report cancelled");
			else context.showError(`Failed to write bug report summary: ${errorMessage(error)}`);
			return;
		}
		restoreEditor(context, loader);
		if (loader.signal.aborted) {
			context.showStatus("Bug report cancelled");
			return;
		}
	}

	let bundle: BugReportBundle;
	try {
		bundle = await buildBundle(context.session, options, summary);
	} catch (error: unknown) {
		context.showError(`Failed to build bug report: ${errorMessage(error)}`);
		return;
	}

	if (options.delivery === "upload") {
		const failure = await upload(context, bundle);
		if (failure === undefined) return;
		const fallback = await choose(
			context,
			"Upload failed",
			["Export as Zip", "Cancel"],
			`${failure}\n\nExport the report as a zip archive instead?`,
		);
		if (fallback !== "Export as Zip") {
			context.showStatus("Bug report cancelled");
			return;
		}
	}
	await exportZip(context, bundle);
}

async function promptForOptions(
	context: BugReportContext,
	initialHint: string | undefined,
): Promise<BugReportOptions | undefined> {
	const hint = await input(context, "Report a bug", `${DISCLAIMER}\n\nWhat went wrong? (optional)`, initialHint);
	if (hint === null) return undefined;
	const transcript = await choose(
		context,
		"Include the session transcript?",
		["Yes, include the transcript", "No"],
		TRANSCRIPT_NOTE,
	);
	if (!transcript) return undefined;
	const includeSession = transcript !== "No";
	let includeSummary = false;
	if (!includeSession) {
		const model = context.session.model;
		const summary = await choose(
			context,
			`Attach a summary written by ${model?.name ?? "the current model"} instead?`,
			["Yes, generate a summary", "No"],
			`The transcript is sent to ${model?.provider ?? "your provider"} with your credentials and tokens. Only the generated summary is attached; the transcript stays on your machine.`,
		);
		if (!summary) return undefined;
		includeSummary = summary !== "No";
	}
	const description = hint.trim();
	const delivery = await choose(
		context,
		"Bug report",
		["Upload Report", "Export as Zip", "Cancel"],
		`Description: ${description || "none"}\nTranscript: ${includeSession ? "included" : "not included"}\nSummary: ${includeSummary ? `written by ${context.session.model?.name ?? "the current model"}` : "none"}\n\nUpload sends the report to ${new URL(getRadiusGatewayUrl()).host}. Export writes a zip archive to the current directory instead.`,
	);
	if (!delivery || delivery === "Cancel") return undefined;
	return {
		hint: description || undefined,
		includeSession,
		includeSummary,
		delivery: delivery === "Upload Report" ? "upload" : "zip",
	};
}

async function buildBundle(
	session: SessionFacade,
	options: BugReportOptions,
	summary: string | undefined,
): Promise<BugReportBundle> {
	const extensions = session.sessionExtensions as unknown as Extension[];
	return {
		metadata: collectBugReportMetadata({
			hint: options.hint,
			sessionId: session.sessionId,
			cwd: session.sessionManager.getCwd(),
			includeSession: options.includeSession,
			includeSummary: summary !== undefined,
			messageCount: session.messages.length,
			model: session.model,
			modelRuntime: session.modelRuntime,
			thinkingLevel: session.thinkingLevel,
			extensions,
			extensionErrors: session.extensionErrors,
			globalSettings: session.settingsManager.getGlobalSettings(),
			projectSettings: session.settingsManager.getProjectSettings(),
		}),
		diagnostics: collectBugReportDiagnostics(readOnlySessionManager(session), readCrashLog()),
		summary,
		sessionJsonl: options.includeSession ? await exportSessionJsonl(session) : undefined,
	};
}

/**
 * The session store of the facade, as the bug report collector reads it.
 *
 * The collector only reads the entries and the id of the session; the rest of the store
 * lives in the server's process.
 */
function readOnlySessionManager(session: SessionFacade): ReadonlySessionManager {
	return {
		getEntries: () => session.sessionManager.getEntries(),
		getSessionId: () => session.sessionManager.getSessionId(),
	} as unknown as ReadonlySessionManager;
}

/** The transcript of the session, with the presentation metadata of the shared viewer. */
async function exportSessionJsonl(session: SessionFacade): Promise<string> {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bug-report-"));
	try {
		const filePath = path.join(tempDir, "session.jsonl");
		await exportSessionForShare(filePath, session);
		return fs.readFileSync(filePath, "utf-8");
	} finally {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}
}

async function upload(context: BugReportContext, bundle: BugReportBundle): Promise<string | undefined> {
	const loader = showLoader(context, "Uploading bug report...");
	try {
		const provider = context.session.modelRuntime.getProvider(RADIUS_PROVIDER_ID);
		const token = provider
			? getAuthCredential(
					await context.session.modelRuntime.getAuth(RADIUS_PROVIDER_ID, { minOAuthValidityMs: 5 * 60_000 }),
				)
			: undefined;
		const result = await uploadBugReport(bundle, { token, signal: loader.signal });
		restoreEditor(context, loader);
		await recordInSession(context.session, bundle, { delivery: "upload" });
		context.showStatus(`Bug report uploaded. Report ID: ${result.id}`);
		return undefined;
	} catch (error: unknown) {
		restoreEditor(context, loader);
		if (loader.signal.aborted) {
			context.showStatus("Bug report cancelled");
			return undefined;
		}
		return errorMessage(error);
	}
}

async function exportZip(context: BugReportContext, bundle: BugReportBundle): Promise<void> {
	const archivePath = path.join(process.cwd(), bugReportArchiveFileName(bundle.metadata.id));
	try {
		await writeBugReportArchive(bundle, archivePath);
	} catch (error: unknown) {
		context.showError(`Failed to write bug report: ${errorMessage(error)}`);
		return;
	}
	await recordInSession(context.session, bundle, { delivery: "zip", path: archivePath });
	context.showStatus(`Bug report exported to: ${archivePath}\nReport ID: ${bundle.metadata.id}`);
}

async function recordInSession(
	session: SessionFacade,
	bundle: BugReportBundle,
	delivery: Pick<BugReportSessionEntryData, "delivery" | "path">,
): Promise<void> {
	await session.sessionManager.appendCustomEntry(BUG_REPORT_CUSTOM_ENTRY_TYPE, {
		id: bundle.metadata.id,
		createdAt: bundle.metadata.createdAt,
		hint: bundle.metadata.hint,
		sessionIncluded: bundle.metadata.session.included,
		summaryIncluded: bundle.metadata.session.summaryIncluded,
		...delivery,
	} satisfies BugReportSessionEntryData);
	if (bundle.diagnostics.crashes.length > 0) clearCrashLog();
}

function input(
	context: BugReportContext,
	title: string,
	description: string,
	initialValue?: string,
): Promise<string | null> {
	return new Promise((resolve) => {
		let component: ExtensionEditorComponent;
		const finish = (value: string | null) => {
			restoreEditor(context, component);
			resolve(value);
		};
		component = new ExtensionEditorComponent(
			context.ui,
			context.keybindings,
			title,
			initialValue,
			(value) => finish(value),
			() => finish(null),
			{ description },
			context.session.settingsManager.getExternalEditorCommand(),
		);
		showOverlay(context, component);
	});
}

function choose(
	context: BugReportContext,
	title: string,
	options: string[],
	description?: string,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		let component: ExtensionSelectorComponent;
		const finish = (value?: string) => {
			restoreEditor(context, component);
			resolve(value);
		};
		component = new ExtensionSelectorComponent(title, options, finish, () => finish(), {
			tui: context.ui,
			description,
		});
		showOverlay(context, component);
	});
}

function showLoader(context: BugReportContext, message: string): BorderedLoader {
	const loader = new BorderedLoader(context.ui, theme, message);
	showOverlay(context, loader);
	return loader;
}

function showOverlay(context: BugReportContext, component: Overlay): void {
	context.editorContainer.clear();
	context.editorContainer.addChild(component);
	context.ui.setFocus(component);
	context.ui.requestRender();
}

function restoreEditor(context: BugReportContext, component: Overlay): void {
	component.dispose?.();
	context.editorContainer.clear();
	context.editorContainer.addChild(context.editor);
	context.ui.setFocus(context.editor);
	context.ui.requestRender();
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown error";
}
