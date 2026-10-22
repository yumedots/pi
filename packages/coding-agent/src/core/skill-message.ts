/**
 * The skill blocks a user message can invoke.
 *
 * The parser lives in a module of its own so that a client can read a skill block without
 * loading the agent session and with it the whole provider set.
 */

/** Parsed skill block from a user message */
export interface ParsedSkillBlock {
	name: string;
	location: string;
	content: string;
}

/** A user message that invoked one or more skills */
export interface ParsedSkillMessage {
	/** The skill blocks that were expanded into the message. */
	blocks: ParsedSkillBlock[];
	/** The request that came with the skills, undefined when the message only invoked skills. */
	userMessage: string | undefined;
}

const SKILL_BLOCK_REGEX = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>/;

/**
 * Parse the skill blocks from message text.
 * Returns null if the text doesn't start with a skill block.
 */
export function parseSkillMessage(text: string): ParsedSkillMessage | null {
	const blocks: ParsedSkillBlock[] = [];
	let rest = text;
	while (true) {
		const match = rest.match(SKILL_BLOCK_REGEX);
		if (!match) break;
		blocks.push({ name: match[1]!, location: match[2]!, content: match[3]! });
		rest = rest.slice(match[0].length);
		if (!rest.startsWith("\n\n")) break;
		rest = rest.slice(2);
	}
	if (blocks.length === 0) return null;
	const userMessage = rest.trim();
	return { blocks, userMessage: userMessage || undefined };
}
