import { type Model, modelsAreEqual } from "@earendil-works/pi-ai";
import { getKeybindings, type Input, type TUI } from "@earendil-works/pi-tui";
import { keyDisplayText } from "../client-support/keybinding-hints.ts";
import { theme } from "../client-theme.ts";
import { refreshModelCatalogs } from "../model-catalog-refresh.ts";
import { getModelSelectorSearchText } from "../model-search.ts";
import type { SessionModelRuntime } from "../session-facade.ts";
import { MenuComponent, type MenuItem } from "./menu.ts";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
}

interface ScopedModelItem {
	model: Model<any>;
	thinkingLevel?: string;
}

interface DefaultModelReference {
	provider: string;
	id: string;
}

type ModelScope = "all" | "scoped";

/**
 * Component that renders a model selector with search
 */
export class ModelSelectorComponent extends MenuComponent<ModelItem> {
	private readonly tui: TUI;
	private readonly currentModel: Model<any> | undefined;
	private readonly modelRuntime: SessionModelRuntime;
	private readonly defaultModel: DefaultModelReference | undefined;
	private readonly onSelectAsDefaultCallback?: (model: Model<any>) => void;
	private scopedModels: ReadonlyArray<ScopedModelItem>;
	private scopedModelItems: ModelItem[] = [];
	private allModels: ModelItem[] = [];
	private activeModels: ModelItem[] = [];
	private scope: ModelScope = "all";
	private errorMessage?: string;
	private refreshStatusMessage = "Refreshing model catalogs…";
	private closed = false;
	private readonly refreshAbortController = new AbortController();
	private refreshTimeout?: ReturnType<typeof setTimeout>;

	constructor(
		tui: TUI,
		currentModel: Model<any> | undefined,
		modelRuntime: SessionModelRuntime,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model<any>) => void,
		onCancel: () => void,
		initialSearchInput?: string,
		onSelectAsDefault?: (model: Model<any>) => void,
		defaultModel?: DefaultModelReference,
	) {
		super(
			{ title: "", items: [], placeholder: "Search" },
			(item) => {
				this.dispose();
				onSelect(item.model);
			},
			onCancel,
		);
		this.tui = tui;
		this.currentModel = currentModel;
		this.modelRuntime = modelRuntime;
		this.scopedModels = scopedModels;
		this.defaultModel = defaultModel;
		this.onSelectAsDefaultCallback = onSelectAsDefault;
		this.scope = scopedModels.length > 0 ? "scoped" : "all";
		this.onSelectionChange = () => this.updateFooter();

		// Render the current snapshot immediately, then refresh in the background.
		this.loadModelsFromSnapshot();
		this.setTitle(this.scopeTitle());
		if (initialSearchInput) this.searchInput.setValue(initialSearchInput);
		this.applyFilter(this.searchInput.getValue());
		this.tui.requestRender();
		void this.refreshModels();
	}

	/** The line above the list: the scope, or the hint about configured providers. */
	private scopeTitle(): string {
		if (this.scopedModelItems.length > 0) {
			const all = this.scope === "all" ? theme.fg("accent", "all") : theme.fg("muted", "all");
			const scoped = this.scope === "scoped" ? theme.fg("accent", "scoped") : theme.fg("muted", "scoped");
			return `${theme.fg("muted", "Scope: ")}${all}${theme.fg("muted", " | ")}${scoped}`;
		}
		return theme.fg("warning", "Only showing models from configured providers. Use /login to add providers.");
	}

	/** The line under the list: the refresh status, the error, or the name of the model. */
	private updateFooter(): void {
		if (this.errorMessage) {
			this.setFooterText(this.errorMessage);
			return;
		}
		if (this.refreshStatusMessage) {
			this.setFooterText(this.refreshStatusMessage);
			return;
		}
		const selected = this.getSelectedValue();
		this.setFooterText(selected ? `Model Name: ${selected.model.name}` : undefined);
	}

	protected override hintLine(): string {
		if (!this.onSelectAsDefaultCallback) return super.hintLine();
		return theme.fg(
			"dim",
			`  ${keyDisplayText("tui.select.confirm")} to select · ${keyDisplayText("app.models.save")} to set as default · ${keyDisplayText("tui.select.cancel")} to cancel`,
		);
	}

	protected override emptyText(): string {
		return "No matching models";
	}

	protected override handleExtraKey(keyData: string): boolean {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.input.tab")) {
			if (this.scopedModelItems.length > 0) this.setScope(this.scope === "all" ? "scoped" : "all");
			return true;
		}
		if (kb.matches(keyData, "app.models.save") && this.onSelectAsDefaultCallback) {
			const selected = this.getSelectedValue();
			if (selected) {
				this.dispose();
				this.onSelectAsDefaultCallback(selected.model);
			}
			return true;
		}
		return false;
	}

	/** Filters the models by the search query, with "default" showing the default model first. */
	protected override applyFilter(query: string): void {
		const trimmed = query.trim();
		const selected = this.getSelectedValue();
		if (!trimmed) {
			this.visibleItems = this.activeModels.map((item) => this.toMenuItem(item));
		} else {
			const search = (item: ModelItem): string => {
				const defaultText = this.isDefaultModel(item.model) ? " default" : "";
				return `${getModelSelectorSearchText({ id: item.id, provider: item.provider, name: item.model.name })}${defaultText}`;
			};
			const filtered = this.activeModels.filter((item) =>
				search(item).toLowerCase().includes(trimmed.toLowerCase()),
			);
			const items = this.isDefaultSearch(trimmed)
				? [
						...this.activeModels.filter((item) => this.isDefaultModel(item.model)),
						...filtered.filter((item) => !this.isDefaultModel(item.model)),
					]
				: filtered;
			this.visibleItems = items.map((item) => this.toMenuItem(item));
		}
		const list = this.getSelectList();
		list.setItems(this.toRows(this.visibleItems));
		// A query moves the selection to the best match. Without one the current model
		// stays selected.
		if (trimmed) {
			list.setSelectedIndex(0);
		} else {
			const index = selected ? this.visibleItems.findIndex((item) => item.value === selected) : -1;
			list.setSelectedIndex(
				index === -1 ? Math.min(this.currentIndex(), Math.max(0, this.visibleItems.length - 1)) : index,
			);
		}
		this.renderContent();
		this.updateFooter();
	}

	/** The row of the current model in the visible list. */
	private currentIndex(): number {
		const index = this.visibleItems.findIndex((item) => modelsAreEqual(this.currentModel, item.value.model));
		return index === -1 ? 0 : index;
	}

	/** The row of a model: the id, the provider and the default marker. */
	private toMenuItem(item: ModelItem): MenuItem<ModelItem> {
		const isCurrent = modelsAreEqual(this.currentModel, item.model);
		return {
			title: `${isCurrent ? "✓ " : "  "}${item.id}`,
			description: `[${item.provider}]${this.isDefaultModel(item.model) ? " · default" : ""}`,
			value: item,
		};
	}

	private isDefaultModel(model: Model<any>): boolean {
		return this.defaultModel?.provider === model.provider && this.defaultModel.id === model.id;
	}

	private isDefaultSearch(query: string): boolean {
		const normalized = query.trim().toLowerCase();
		return normalized.length > 0 && "default".startsWith(normalized);
	}

	private setScope(scope: ModelScope): void {
		if (this.scope === scope) return;
		this.scope = scope;
		this.activeModels = this.scope === "scoped" ? this.scopedModelItems : this.allModels;
		this.setTitle(this.scopeTitle());
		this.applyFilter(this.searchInput.getValue());
	}

	private loadModelsFromSnapshot(): void {
		const models = this.modelRuntime.getAvailableSnapshot().map((model: Model<any>) => ({
			provider: model.provider,
			id: model.id,
			model,
		}));
		this.allModels = this.sortModels(models);
		this.scopedModels = this.scopedModels.map((scoped) => {
			const refreshed = this.modelRuntime.getModel(scoped.model.provider, scoped.model.id);
			return refreshed ? { ...scoped, model: refreshed } : scoped;
		});
		this.scopedModelItems = this.scopedModels.map((scoped) => ({
			provider: scoped.model.provider,
			id: scoped.model.id,
			model: scoped.model,
		}));
		this.activeModels = this.scope === "scoped" ? this.scopedModelItems : this.allModels;
	}

	private sortModels(models: ModelItem[]): ModelItem[] {
		const sorted = [...models];
		// Sort: current model first, default model second, then by provider.
		sorted.sort((a, b) => {
			const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
			const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			const aIsDefault = this.isDefaultModel(a.model);
			const bIsDefault = this.isDefaultModel(b.model);
			if (aIsDefault && !bIsDefault) return -1;
			if (!aIsDefault && bIsDefault) return 1;
			return a.provider.localeCompare(b.provider);
		});
		return sorted;
	}

	private async refreshModels(): Promise<void> {
		const timeoutMs = 15_000;
		let timedOut = false;
		this.refreshTimeout = setTimeout(() => {
			timedOut = true;
			this.refreshAbortController.abort();
		}, timeoutMs);
		try {
			const result = await refreshModelCatalogs(this.modelRuntime, this.refreshAbortController.signal);
			if (this.closed) return;
			this.refreshStatusMessage = "";
			if (result.aborted && timedOut) {
				this.errorMessage = "Model refresh timed out; showing cached models.";
			} else if (result.errors.size === 1) {
				this.errorMessage = `Could not refresh ${result.errors.keys().next().value}; showing cached models.`;
			} else if (result.errors.size > 1) {
				this.errorMessage = `Could not refresh ${result.errors.size} model catalogs (${[...result.errors.keys()].join(", ")}); showing cached models.`;
			} else {
				this.errorMessage = this.modelRuntime.getError();
				if (!this.errorMessage) {
					this.refreshStatusMessage = "Model catalogs refreshed.";
				}
			}
			this.loadModelsFromSnapshot();
			this.applyFilter(this.searchInput.getValue());
			this.tui.requestRender();
		} catch (error) {
			if (this.closed) return;
			this.refreshStatusMessage = "";
			this.errorMessage = timedOut
				? "Model refresh timed out; showing cached models."
				: `Could not refresh model catalogs: ${error instanceof Error ? error.message : String(error)}`;
			this.applyFilter(this.searchInput.getValue());
			this.tui.requestRender();
		} finally {
			if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
		}
	}

	dispose(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
		this.refreshAbortController.abort();
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
