import {
	BlockList,
	Box,
	type Component,
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	Text,
} from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
import { ThemedText } from "./themed-text.ts";

export interface MenuItem<T> {
	title: string;
	description?: string;
	value: T;
}

export interface MenuSelectorOptions<T> {
	title: string;
	items?: MenuItem<T>[];
	placeholder?: string;
	maxVisible?: number;
	/** Rendered in place of the list while the items are still loading. */
	loadingText?: string;
}

const DEFAULT_MAX_VISIBLE = 10;

const blockListTheme = {
	block: (text: string) => text,
	selection: (text: string) => theme.bg("menuSelectedBg", text),
	track: (text: string) => theme.fg("scrollbarTrack", text),
	thumb: (text: string) => theme.fg("scrollbarThumb", text),
};

export class MenuSelectorComponent<T> extends Container implements Focusable {
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	protected searchInput: Input;
	protected blockList: BlockList<MenuItem<T>>;
	private allItems: MenuItem<T>[];
	private filteredItems: MenuItem<T>[];
	private maxVisible: number;
	private title: string;
	private panelWidth = 60;
	private loading: boolean;
	private loadingText: string;
	private footerText: string | undefined;
	private onSelectCallback: (value: T) => void;
	private onCancelCallback: () => void;

	constructor(options: MenuSelectorOptions<T>, onSelect: (value: T) => void, onCancel: () => void) {
		super();

		this.title = options.title;
		this.allItems = options.items ?? [];
		this.filteredItems = this.allItems;
		this.maxVisible = options.maxVisible ?? DEFAULT_MAX_VISIBLE;
		this.loading = options.items === undefined;
		this.loadingText = options.loadingText ?? "Loading...";
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		this.searchInput = new Input({
			placeholder: options.placeholder ?? "Search",
			placeholderStyle: (text) => theme.fg("muted", text),
			textStyle: (text) => theme.fg("text", text),
		});
		this.searchInput.onSubmit = () => this.submit();
		this.searchInput.onEscape = () => this.cancel();

		this.blockList = new BlockList<MenuItem<T>>(this.filteredItems, this.maxVisible, blockListTheme, {
			draw: (item, selected, width) => this.drawItem(item, selected, width),
		});
		this.blockList.onSelect = (item) => this.onSelectCallback(item.value);
		this.blockList.onCancel = () => this.onCancelCallback();
		this.blockList.onSelectionChange = (item) => this.onSelectionChange?.(item.value);

		this.renderPanel();
	}

	/** Called when the highlighted row changes. */
	onSelectionChange?: (value: T) => void;

	/** Render a single row. Subclasses override to customize the layout. */
	protected drawItem(item: MenuItem<T>, selected: boolean, _width: number): string {
		const title = selected ? theme.fg("accent", item.title) : theme.fg("text", item.title);
		const description = item.description ? theme.fg("muted", item.description) : "";
		const text = description ? `${title}  ${description}` : title;
		return `  ${text}`;
	}

	/** The panel title. Subclasses override to show dynamic state. */
	protected getTitle(): string {
		return this.title;
	}

	/** Extra hint lines rendered under the list. */
	protected extraFooterLines(): string[] {
		return [];
	}

	/** Handle a key before the menu's own bindings. Return true to consume it. */
	protected handleExtraKey(_keyData: string): boolean {
		return false;
	}

	protected renderPanel(): void {
		this.clear();
		this.addChild(this.wrapPanel(this.buildContent()));
	}

	/** Build the panel content. Subclasses override to change the layout. */
	protected buildContent(): Component {
		const panel = new Container();

		// ThemedText rebuilds its string after the invalidation a theme change performs.
		panel.addChild(
			new ThemedText(
				() => {
					const title = this.getTitle();
					const titleLine = theme.bold(theme.fg("text", `  ${title}`));
					const escHint = theme.fg("muted", "  esc");
					return `${titleLine}${" ".repeat(Math.max(0, this.panelWidth - title.length - 6))}${escHint}`;
				},
				0,
				0,
			),
		);
		panel.addChild(this.searchInput);
		panel.addChild(new Text("", 0, 0));

		if (this.loading) {
			panel.addChild(new ThemedText(() => theme.fg("muted", `  ${this.loadingText}`), 0, 0));
			return panel;
		}

		panel.addChild(this.blockList);

		if (this.filteredItems.length === 0) {
			const emptyText = this.allItems.length === 0 ? "No items available" : "No results found";
			panel.addChild(new ThemedText(() => theme.fg("muted", `  ${emptyText}`), 0, 0));
		}

		if (this.footerText) {
			panel.addChild(new ThemedText(() => theme.fg("muted", `  ${this.footerText}`), 0, 0));
		}

		panel.addChild(new ThemedText(() => this.extraFooterLines().join("\n"), 0, 0));

		return panel;
	}

	/** Paint the panel background behind the content. */
	protected wrapPanel(content: Component): Component {
		const box = new Box(0, 0, (text) => this.paintPanel(text));
		box.addChild(content);
		return box;
	}

	/** A reset in the content clears the background, so it is re-applied after every reset. */
	private paintPanel(text: string): string {
		const bg = theme.bgStart("panelBg");
		return theme.bg("panelBg", text.replace(/(\x1b\[(?:0|49)m)/g, `$1${bg}`));
	}

	/** Replace the items once an async source has finished loading. */
	setItems(items: MenuItem<T>[]): void {
		this.allItems = items;
		this.filteredItems = items;
		this.loading = false;
		this.blockList.setItems(items);
		this.renderPanel();
	}

	/** Show the loading placeholder again while a new source is fetched. */
	setLoading(loading: boolean): void {
		this.loading = loading;
		this.renderPanel();
	}

	/** Show a transient message under the list. */
	setFooterText(text: string | undefined): void {
		this.footerText = text;
		this.renderPanel();
	}

	/** The value of the highlighted row, if any. */
	getSelectedValue(): T | undefined {
		return this.blockList.getSelectedItem()?.value;
	}

	/** Apply the search query to the items. Subclasses override for custom matching. */
	protected applyFilter(query: string): void {
		if (!query.trim()) {
			this.filteredItems = this.allItems;
		} else {
			this.filteredItems = fuzzyFilter(this.allItems, query, (item) => `${item.title} ${item.description ?? ""}`);
		}
		this.blockList.setItems(this.filteredItems);
		this.renderPanel();
	}

	private submit(): void {
		const item = this.blockList.getSelectedItem();
		if (item) {
			this.onSelectCallback(item.value);
		}
	}

	private cancel(): void {
		this.onCancelCallback();
	}

	handleInput(keyData: string): void {
		if (this.handleExtraKey(keyData)) {
			return;
		}

		const kb = getKeybindings();

		if (kb.matches(keyData, "tui.select.up")) {
			this.blockList.handleInput(keyData);
			return;
		}

		if (kb.matches(keyData, "tui.select.down")) {
			this.blockList.handleInput(keyData);
			return;
		}

		if (kb.matches(keyData, "tui.select.confirm")) {
			this.submit();
			return;
		}

		if (kb.matches(keyData, "tui.select.cancel") || keyData === "\x1b") {
			this.cancel();
			return;
		}

		const previousValue = this.searchInput.getValue();
		this.searchInput.handleInput(keyData);
		const newValue = this.searchInput.getValue();
		if (newValue !== previousValue) {
			this.applyFilter(newValue);
		}
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
