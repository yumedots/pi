import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("export HTML skill block rendering", () => {
	const templateJs = readFileSync(new URL("../src/core/export-html/template.js", import.meta.url), "utf-8");

	it("strips skill wrapper XML from user message rendering", () => {
		// Skill commands store a structural wrapper in the raw user message:
		//   <skill name="..." location="...">\n...\n</skill>\n\nactual prompt
		// The export renderer must detect that wrapper and render only the user-visible prompt,
		// not the Pi-generated <skill>...</skill> XML tags.
		expect(templateJs).toMatch(/parseSkillMessage/);
		expect(templateJs).toMatch(/skillMessage\.userMessage/);
	});

	it("renders the request that came with a skill inside the skill block", () => {
		// The skill invocation and the request typed alongside it are one message, so the
		// request must render inside the skill-invocation div instead of as a separate
		// block after it, matching the TUI layout where the request is part of
		// SkillInvocationMessageComponent.
		expect(templateJs).toMatch(/skill-user-request/);
		expect(templateJs).not.toMatch(/hasUserContent/);
	});

	it("labels the skill invocation with an @ mention", () => {
		// The invocation is shown as "@name" so it matches what the user typed.
		expect(templateJs).toMatch(/skill-invocation-label">\$\{escapeHtml\(names\)\}/);
	});

	it("renders skill content as markdown, not raw text", () => {
		// The skill block body is markdown (from the SKILL.md file).
		// It should be rendered through safeMarkedParse, not escaped as raw text.
		expect(templateJs).toMatch(/safeMarkedParse\(block\.content\)/);
	});

	it("shows skill name and user message in the sidebar tree", () => {
		// The sidebar tree should display both the skill name and the user prompt,
		// not just one or the other.
		expect(templateJs).toMatch(/tree-role-skill/);
	});
});
