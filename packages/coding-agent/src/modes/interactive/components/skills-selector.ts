import { BlockList, Container, type Focusable, Spacer, Text } from "@earendil-works/pi-tui";
import type { Skill } from "../../../core/skills.ts";
import { getBlockListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const MAX_VISIBLE_SKILLS = 10;

export class SkillsSelectorComponent extends Container implements Focusable {
	private blockList: BlockList<Skill>;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	constructor(skills: Skill[], onSelect: (skill: Skill) => void, onCancel: () => void) {
		super();

		this.blockList = new BlockList(
			skills,
			Math.max(1, Math.min(MAX_VISIBLE_SKILLS, skills.length)),
			getBlockListTheme(),
			{ draw: (skill, selected) => this.drawSkill(skill, selected) },
		);
		this.blockList.onSelect = onSelect;
		this.blockList.onCancel = onCancel;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text("Skills", 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.blockList);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
	}

	handleInput(keyData: string): void {
		this.blockList.handleInput(keyData);
	}

	getBlockList(): BlockList<Skill> {
		return this.blockList;
	}

	private drawSkill(skill: Skill, selected: boolean): string {
		const name = `${selected ? theme.fg("accent", skill.name) : skill.name}`;
		return skill.description ? ` ${name}  ${theme.fg("dim", skill.description)}` : ` ${name}`;
	}
}
