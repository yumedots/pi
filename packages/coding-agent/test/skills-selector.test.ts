import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { Skill } from "../src/core/skills.ts";
import { SkillsSelectorComponent } from "../src/modes/interactive/components/skills-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const createSkill = (name: string, description = ""): Skill => ({
	name,
	description,
	filePath: `/skills/${name}/SKILL.md`,
	baseDir: `/skills/${name}`,
	sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "local", scope: "user", origin: "top-level" },
	disableModelInvocation: false,
});

const renderBody = (selector: SkillsSelectorComponent): string => stripAnsi(selector.render(60).join("\n"));

describe("skills selector", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("renders every skill with its description", () => {
		const selector = new SkillsSelectorComponent(
			[createSkill("commit", "Write a commit"), createSkill("review", "Review a diff")],
			() => {},
			() => {},
		);

		const body = renderBody(selector);
		expect(body).toContain("Skills");
		expect(body).toContain("commit");
		expect(body).toContain("Write a commit");
		expect(body).toContain("review");
		expect(body).toContain("Review a diff");
	});

	it("runs the highlighted skill on confirm", () => {
		const onSelect = vi.fn();
		const selector = new SkillsSelectorComponent([createSkill("commit"), createSkill("review")], onSelect, () => {});

		selector.handleInput("\x1b[B");
		expect(selector.getBlockList().getSelectedItem()?.name).toBe("review");

		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "review" }));
	});

	it("cancels on escape", () => {
		const onCancel = vi.fn();
		const selector = new SkillsSelectorComponent([createSkill("commit")], () => {}, onCancel);

		selector.handleInput("\x1b");
		expect(onCancel).toHaveBeenCalled();
	});
});
