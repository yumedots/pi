import { dirname } from "node:path";
import type { ProjectTrustOption, ProjectTrustStoreEntry } from "@earendil-works/pi-coding-agent/core/trust-manager";
import { Container, getKeybindings, Spacer, Text } from "@earendil-works/pi-tui";
import { DynamicBorder } from "../client-support/dynamic-border.ts";
import { keyHint, rawKeyHint } from "../client-support/keybinding-hints.ts";
import { canonicalizePath, resolvePath } from "../client-support/paths.ts";
import { theme } from "../client-theme.ts";

export type TrustSelection = Pick<ProjectTrustOption, "trusted" | "updates">;

function normalizeCwd(cwd: string): string {
	return canonicalizePath(resolvePath(cwd));
}

function getProjectTrustParentPath(cwd: string): string | undefined {
	const trustPath = normalizeCwd(cwd);
	const parentPath = dirname(trustPath);
	return parentPath === trustPath ? undefined : parentPath;
}

/** The trust the user can give: the directory itself, its parent, or nothing. */
function getProjectTrustOptions(cwd: string): ProjectTrustOption[] {
	const trustPath = normalizeCwd(cwd);
	const trustOptions: ProjectTrustOption[] = [
		{ label: "Trust", trusted: true, updates: [{ path: trustPath, decision: true }], savedPath: trustPath },
	];
	const parentPath = getProjectTrustParentPath(cwd);
	if (parentPath !== undefined) {
		trustOptions.push({
			label: `Trust parent folder (${parentPath})`,
			trusted: true,
			updates: [
				{ path: parentPath, decision: true },
				{ path: trustPath, decision: null },
			],
			savedPath: parentPath,
		});
	}
	trustOptions.push({
		label: "Do not trust",
		trusted: false,
		updates: [{ path: trustPath, decision: false }],
		savedPath: trustPath,
	});
	return trustOptions;
}

export interface TrustSelectorOptions {
	cwd: string;
	savedDecision: ProjectTrustStoreEntry | null;
	projectTrusted: boolean;
	onSelect: (selection: TrustSelection) => void;
	onCancel: () => void;
}

function formatDecision(trustPath: string | undefined, decision: ProjectTrustStoreEntry | null): string {
	if (decision === null) {
		return "none";
	}
	const label = decision.decision ? "trusted" : "untrusted";
	if (trustPath !== undefined && decision.path !== trustPath) {
		return `${label} (inherited from ${decision.path})`;
	}
	return `${label} (${decision.path})`;
}

export class TrustSelectorComponent extends Container {
	private selectedIndex: number;
	private readonly listContainer: Container;
	private readonly trustOptions: ProjectTrustOption[];
	private readonly savedDecision: ProjectTrustStoreEntry | null;
	private readonly onSelectCallback: (selection: TrustSelection) => void;
	private readonly onCancelCallback: () => void;

	constructor(options: TrustSelectorOptions) {
		super();

		this.savedDecision = options.savedDecision;
		this.trustOptions = getProjectTrustOptions(options.cwd);
		this.selectedIndex = Math.max(
			0,
			this.trustOptions.findIndex((option) => this.isSavedOption(option)),
		);
		this.onSelectCallback = options.onSelect;
		this.onCancelCallback = options.onCancel;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", theme.bold("Project trust")), 1, 0));
		this.addChild(new Text(theme.fg("muted", options.cwd), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg(
					"muted",
					`Saved decision: ${formatDecision(this.trustOptions[0]?.savedPath, options.savedDecision)}`,
				),
				1,
				0,
			),
		);
		this.addChild(
			new Text(theme.fg("muted", `Current session: ${options.projectTrusted ? "trusted" : "untrusted"}`), 1, 0),
		);
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				rawKeyHint("↑↓", "navigate") +
					"  " +
					keyHint("tui.select.confirm", "save") +
					"  " +
					keyHint("tui.select.cancel", "cancel"),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.updateList();
	}

	private isSavedOption(option: ProjectTrustOption): boolean {
		return (
			option.savedPath !== undefined &&
			this.savedDecision?.decision === option.trusted &&
			this.savedDecision.path === option.savedPath
		);
	}

	private updateList(): void {
		this.listContainer.clear();
		for (let i = 0; i < this.trustOptions.length; i++) {
			const option = this.trustOptions[i];
			if (!option) {
				continue;
			}

			const isSelected = i === this.selectedIndex;
			const isCurrent = this.isSavedOption(option);
			const currentMarker = isCurrent ? theme.fg("accent", "✓ ") : "  ";
			const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
			const label = isSelected ? theme.fg("accent", option.label) : theme.fg("text", option.label);
			this.listContainer.addChild(new Text(`${prefix}${currentMarker}${label}`, 1, 0));
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
			this.selectedIndex = Math.min(this.trustOptions.length - 1, this.selectedIndex + 1);
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
			const selected = this.trustOptions[this.selectedIndex];
			if (selected) {
				this.onSelectCallback({ trusted: selected.trusted, updates: selected.updates });
			}
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
		}
	}
}
