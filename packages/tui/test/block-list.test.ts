import assert from "node:assert";
import { describe, it } from "node:test";
import { BlockList, type BlockListTheme } from "../src/components/block-list.ts";
import { visibleWidth } from "../src/utils.ts";

const testTheme: BlockListTheme = {
	block: (text) => text,
	selection: (text) => text,
	track: (text) => text,
	thumb: (text) => text,
};

const createList = (count: number, maxVisible: number): BlockList<string> =>
	new BlockList(
		Array.from({ length: count }, (_, index) => `item-${index}`),
		maxVisible,
		testTheme,
		{ draw: (item, selected) => (selected ? `> ${item}` : `  ${item}`) },
	);

describe("BlockList", () => {
	it("scrolls so the selection stays visible", () => {
		const list = createList(20, 5);
		assert.deepStrictEqual(list.render(40).length, 5);
		assert.match(list.render(40)[0]!, /item-0/);

		for (let i = 0; i < 7; i++) list.move(1);

		const lines = list.render(40);
		assert.match(lines[4]!, /> item-7/);
		assert.ok(!lines.join("\n").includes("item-2"));
	});

	it("draws a scrollbar only when the list overflows", () => {
		const fitting = createList(3, 5);
		assert.ok(!fitting.render(40).join("\n").includes("█"));
		assert.ok(!fitting.render(40).join("\n").includes("│"));

		const overflowing = createList(20, 5);
		const top = overflowing.render(40);
		assert.match(top[0]!, /█$/);

		overflowing.setSelectedIndex(19);
		const bottom = overflowing.render(40);
		assert.match(bottom[4]!, /█$/);
		assert.ok(!bottom[0]!.endsWith("█"));
	});

	it("renders every row at the requested width", () => {
		const list = createList(20, 5);
		for (const line of list.render(30)) assert.strictEqual(visibleWidth(line), 30);

		const fitting = createList(3, 5);
		for (const line of fitting.render(30)) assert.strictEqual(visibleWidth(line), 30);
	});

	it("selects and cancels through keybindings", () => {
		const list = createList(5, 5);
		let selected: string | null = null;
		let cancelled = false;
		list.onSelect = (item) => {
			selected = item;
		};
		list.onCancel = () => {
			cancelled = true;
		};

		list.handleInput("\x1b[B");
		list.handleInput("\r");
		assert.strictEqual(selected, "item-1");

		list.handleInput("\x1b");
		assert.strictEqual(cancelled, true);
	});
});
