import { getSelectListTheme, theme } from "@earendil-works/pi-coding-agent/core/theme/theme";
import { keyHint } from "@earendil-works/pi-coding-agent/core/ui/keybinding-hints";
import {
	type Component,
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	getTerminalRows,
	Input,
	type SelectItem,
	SelectList,
	Spacer,
	Text,
	type TuiMouseDispatchResult,
	type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { ThemedText } from "./themed-text.ts";

export interface MenuItem<T> {
	title: string;
	description?: string;
	value: T;
}

export interface MenuOptions<T> {
	/** The heading above the search field. */
	title?: string;
	/** The items of the menu. Undefined while they are still loading. */
	items?: MenuItem<T>[];
	placeholder?: string;
	maxVisible?: number;
	/** Shown in place of the list while the items are loading. */
	loadingText?: string;
	/**
	 * When set, the menu floats above its own box instead of taking up space in
	 * the layout. The editor's autocomplete list floats the same way, so a menu
	 * that opens above the input box does not move the chat.
	 */
	floating?: boolean;
}

export const DEFAULT_MAX_VISIBLE = 10;

const MENU_CHROME_ROWS = 7;

export function defaultMenuMaxVisible(rows: number = getTerminalRows()): number {
	return Math.min(DEFAULT_MAX_VISIBLE, Math.max(3, Math.floor(rows / 3) - MENU_CHROME_ROWS));
}

/**
 * A menu of items. It looks like the settings list: a search field, the rows of
 * the list, and a hint. The rows come from the shared select list, so every
 * menu of the app looks the same.
 */
export class MenuComponent<T> extends Container implements Focusable {
	private _focused = false;
	private readonly options: MenuOptions<T>;
	protected readonly searchInput: Input;
	private list: SelectList | undefined;
	/** The items the list shows, in the order of the rows. */
	protected visibleItems: MenuItem<T>[] = [];
	private allItems: MenuItem<T>[] = [];
	private loading: boolean;
	private loadingText: string;
	private footerText: string | undefined;
	private readonly onSelectCallback: (value: T) => void;
	private readonly onCancelCallback: () => void;
	/** Set once the content has been built. */
	private built = false;
	/** True when the menu floats above its box instead of taking up space. */
	private floating: boolean;
	/** The lines of the menu, kept for the floating overlay. */
	private contentLines: string[] = [];
	/** The rows the list shows at most. */
	protected readonly maxVisible: number;
	/** The rows the list area keeps, so the rows below it stay where they are. */
	private listAreaRows = 0;

	/** Called when the highlighted row changes. */
	onSelectionChange?: (value: T) => void;

	constructor(options: MenuOptions<T>, onSelect: (value: T) => void, onCancel: () => void) {
		super();
		this.options = options;
		this.allItems = options.items ?? [];
		this.visibleItems = this.allItems;
		this.loading = options.items === undefined;
		this.loadingText = options.loadingText ?? "Loading...";
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		this.floating = options.floating ?? false;
		this.maxVisible = options.maxVisible ?? defaultMenuMaxVisible();

		this.searchInput = new Input({
			placeholder: options.placeholder ?? "Search",
			placeholderStyle: (text) => theme.fg("muted", text),
			textStyle: (text) => theme.fg("text", text),
		});
		this.searchInput.onSubmit = () => this.submit();
		this.searchInput.onEscape = () => this.cancel();
	}

	/**
	 * Show the menu in the layout instead of floating it above its own box. A floating menu
	 * covers the content above it, which the empty-session screen does not want.
	 */
	setFloating(floating: boolean): void {
		this.floating = floating;
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	override render(width: number): string[] {
		if (!this.built) {
			this.built = true;
			this.renderContent();
		}
		this.contentLines = super.render(width);
		// A floating menu is painted above its own box, so it takes no space in the layout.
		return this.floating ? [] : this.contentLines;
	}

	/**
	 * The lines of a floating menu. The container paints them above the box of the
	 * menu, which puts them right above the input box.
	 */
	override renderOverlayAbove(_width: number): string[] {
		return this.floating ? this.contentLines : [];
	}

	override handleMouse(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
		if (!this.floating || event.y >= 0) return super.handleMouse(event);
		// A floating menu is painted above its own box, so its rows have negative
		// coordinates. The last row of the menu sits right above the box.
		const height = this.contentLines.length;
		return super.handleMouse({ ...event, y: event.y + height, height });
	}

	/**
	 * The list of rows. It is created on first use, so a subclass can set up
	 * its own rows without the base class knowing about them.
	 */
	protected getList(): SelectList {
		if (!this.list) {
			this.list = this.createList();
			this.list.setItems(this.toRows(this.visibleItems));
		}
		return this.list;
	}

	/** Creates the list of rows. Subclasses override it to draw their own rows. */
	protected createList(): SelectList {
		const list = new SelectList([], this.maxVisible, getSelectListTheme());
		list.onSelect = (row) => this.selectRow(row);
		list.onCancel = () => this.cancel();
		list.onSelectionChange = (row) => this.onSelectionChange?.(this.itemOf(row).value);
		return list;
	}

	/** The item of a row of the list. */
	protected itemOf(row: SelectItem): MenuItem<T> {
		return this.visibleItems[Number(row.value)]!;
	}

	/**
	 * The rows the list area keeps. The menu takes the height it has when it opens,
	 * so the rows below the list stay where they are when the items arrive.
	 */
	private listArea(): number {
		if (this.listAreaRows === 0) {
			const items = this.allItems.length;
			const rows = this.loading || items === 0 ? this.maxVisible : Math.min(this.maxVisible, items);
			const scrolls = this.loading || items === 0 || items > this.maxVisible;
			this.listAreaRows = rows + (scrolls ? 1 : 0);
		}
		return this.listAreaRows;
	}

	/** The rows the list takes right now. */
	private listHeight(): number {
		const shown = Math.min(this.visibleItems.length, this.maxVisible);
		return shown + (this.visibleItems.length > this.maxVisible ? 1 : 0);
	}

	/** Builds the content of the menu. Subclasses override it for their own layout. */
	protected buildContent(): Component {
		const content = new Container();

		if (this.options.title) {
			content.addChild(new ThemedText(() => theme.fg("dim", `  ${this.options.title}`), 0, 0));
		}
		content.addChild(this.searchInput);
		content.addChild(new Text("", 0, 0));

		if (this.loading) {
			content.addChild(new ThemedText(() => theme.fg("muted", `  ${this.loadingText}`), 0, 0));
		} else if (this.visibleItems.length === 0) {
			content.addChild(new ThemedText(() => theme.fg("muted", `  ${this.emptyText()}`), 0, 0));
		} else {
			content.addChild(this.getList());
		}

		const used = this.loading || this.visibleItems.length === 0 ? 1 : this.listHeight();
		for (let row = used; row < this.listArea(); row++) {
			content.addChild(new Spacer(1));
		}

		if (this.footerText) {
			content.addChild(new ThemedText(() => theme.fg("muted", `  ${this.footerText}`), 0, 0));
		} else {
			content.addChild(new ThemedText(() => theme.fg("muted", ""), 0, 0));
		}

		content.addChild(new Text("", 0, 0));
		content.addChild(new ThemedText(() => this.hintLine(), 0, 0));

		return content;
	}

	/** The hint under the list. */
	protected hintLine(): string {
		return theme.fg(
			"dim",
			`  Type to search · ${keyHint("tui.select.confirm", "select")} · ${keyHint("tui.select.cancel", "cancel")}`,
		);
	}

	/** The text shown when the menu has no rows to show. */
	protected emptyText(): string {
		return this.allItems.length === 0 ? "No items available" : "No results found";
	}

	/** Handles a key before the menu handles it. Return true to consume it. */
	protected handleExtraKey(_keyData: string): boolean {
		return false;
	}

	handleInput(keyData: string): void {
		if (this.handleExtraKey(keyData)) {
			return;
		}

		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up") || kb.matches(keyData, "tui.select.down")) {
			this.getList().handleInput(keyData);
			return;
		}

		const previousQuery = this.searchInput.getValue();
		this.searchInput.handleInput(keyData);
		const query = this.searchInput.getValue();
		if (query !== previousQuery) {
			this.applyFilter(query);
		}
	}

	/** Replaces the items of the menu and shows them. */
	setItems(items: MenuItem<T>[]): void {
		this.allItems = items;
		this.visibleItems = items;
		this.loading = false;
		this.list?.setItems(this.toRows(items));
		this.renderContent();
	}

	/** Changes the title above the search field. */
	setTitle(title: string): void {
		this.options.title = title;
		this.renderContent();
	}

	/** Shows the loading placeholder again while a new source is fetched. */
	setLoading(loading: boolean): void {
		this.loading = loading;
		this.renderContent();
	}

	/** Shows a transient message under the list. */
	setFooterText(text: string | undefined): void {
		this.footerText = text;
		this.renderContent();
	}

	/** The value of the highlighted row, if any. */
	getSelectedValue(): T | undefined {
		const row = this.list?.getSelectedItem();
		return row ? this.itemOf(row).value : undefined;
	}

	/** The list of rows. */
	getSelectList(): SelectList {
		return this.getList();
	}

	/** The items the list shows right now. */
	getVisibleItems(): MenuItem<T>[] {
		return this.visibleItems;
	}

	/** All items of the menu, including the ones the search filters out. */
	getAllItems(): MenuItem<T>[] {
		return this.allItems;
	}

	/** Applies the search query to the items. Subclasses override it for other matching. */
	protected applyFilter(query: string): void {
		this.visibleItems = query.trim()
			? fuzzyFilter(this.allItems, query, (item) => `${item.title} ${item.description ?? ""}`)
			: this.allItems;
		this.list?.setItems(this.toRows(this.visibleItems));
		this.renderContent();
	}

	private selectRow(row: SelectItem): void {
		this.onSelectCallback(this.itemOf(row).value);
	}

	private submit(): void {
		const row = this.getList().getSelectedItem();
		if (row) {
			this.selectRow(row);
		}
	}

	protected cancel(): void {
		this.onCancelCallback();
	}

	protected toRows(items: MenuItem<T>[]): SelectItem[] {
		return items.map((item, index) => ({
			value: String(index),
			label: item.title,
			description: item.description,
		}));
	}

	/** Rebuilds the content of the menu. */
	protected renderContent(): void {
		this.clear();
		this.addChild(this.buildContent());
	}
}
