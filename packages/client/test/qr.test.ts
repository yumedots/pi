import { describe, expect, it } from "vitest";
import { encodeQr, renderQr } from "../src/qr.ts";

/**
 * The data codewords of the specification's example: "01234567" in version 1 at level M.
 *
 * The example is the one of ISO/IEC 18004, annex I: the payload is encoded in numeric mode,
 * the terminator and the padding codewords fill the rest of the sixteen data codewords.
 */
const SPECIFICATION_DATA_CODEWORDS = [
	0b00010000, 0b00100000, 0b00001100, 0b01010110, 0b01100001, 0b10000000, 0b11101100, 0b00010001, 0b11101100,
	0b00010001, 0b11101100, 0b00010001, 0b11101100, 0b00010001, 0b11101100, 0b00010001,
];

/** The error correction codewords of the same example. */
const SPECIFICATION_EC_CODEWORDS = [
	0b10100101, 0b00100100, 0b11010100, 0b11000001, 0b11101101, 0b00110110, 0b11000111, 0b10000111, 0b00101100,
	0b01010101,
];

/** The error correction codewords per block, indexed by level and then by version. */
const EC_CODEWORDS_PER_BLOCK: Record<string, readonly number[]> = {
	L: [
		7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30,
		30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
	],
	M: [
		10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28,
		28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
	],
	Q: [
		13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30,
		30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
	],
	H: [
		17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30,
		30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
	],
};

/** The number of error correction blocks, indexed by level and then by version. */
const EC_BLOCKS: Record<string, readonly number[]> = {
	L: [
		1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19,
		19, 20, 21, 22, 24, 25,
	],
	M: [
		1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33,
		35, 37, 38, 40, 43, 45, 47, 49,
	],
	Q: [
		1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43,
		45, 48, 51, 53, 56, 59, 62, 65, 68,
	],
	H: [
		1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51,
		54, 57, 60, 63, 66, 70, 74, 77, 81,
	],
};

/** The centers of the alignment patterns of a version. */
function alignmentPositions(version: number): number[] {
	if (version === 1) return [];
	const count = Math.floor(version / 7) + 2;
	const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
	const positions = [6];
	for (let position = 4 * version + 10; positions.length < count; position -= step) positions.splice(1, 0, position);
	return positions;
}

/** Whether a module carries a function pattern instead of data. */
function isFunctionModule(size: number, x: number, y: number): boolean {
	for (const [centerX, centerY] of [
		[3, 3],
		[size - 4, 3],
		[3, size - 4],
	]) {
		if (Math.abs(x - centerX) <= 4 && Math.abs(y - centerY) <= 4) return true;
	}
	if (x === 6 || y === 6) return true;
	if (x === 8 && (y <= 8 || y >= size - 8)) return true;
	if (y === 8 && (x <= 8 || x >= size - 8)) return true;
	const version = (size - 17) / 4;
	if (version >= 7 && x >= size - 11 && x < size - 8 && y < 6) return true;
	if (version >= 7 && y >= size - 11 && y < size - 8 && x < 6) return true;
	for (const centerY of alignmentPositions(version)) {
		for (const centerX of alignmentPositions(version)) {
			const corner =
				(centerX === 6 && centerY === 6) ||
				(centerX === 6 && centerY === size - 7) ||
				(centerX === size - 7 && centerY === 6);
			if (!corner && Math.abs(x - centerX) <= 2 && Math.abs(y - centerY) <= 2) return true;
		}
	}
	return false;
}

/** The mask patterns of the specification. */
const MASK_PATTERNS: readonly ((row: number, column: number) => boolean)[] = [
	(row, column) => (row + column) % 2 === 0,
	(row) => row % 2 === 0,
	(_row, column) => column % 3 === 0,
	(row, column) => (row + column) % 3 === 0,
	(row, column) => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
	(row, column) => ((row * column) % 2) + ((row * column) % 3) === 0,
	(row, column) => (((row * column) % 2) + ((row * column) % 3)) % 2 === 0,
	(row, column) => (((row + column) % 2) + ((row * column) % 3)) % 2 === 0,
];

/** The format information of a symbol: the error correction level and the mask. */
function readFormat(modules: boolean[][]): { ecLevel: string; mask: number } {
	let bits = 0;
	const set = (index: number, isDark: boolean): void => {
		if (isDark) bits |= 1 << index;
	};
	for (let i = 0; i <= 5; i++) set(i, modules[i]?.[8] === true);
	set(6, modules[7]?.[8] === true);
	set(7, modules[8]?.[8] === true);
	set(8, modules[8]?.[7] === true);
	for (let i = 9; i < 15; i++) set(i, modules[8]?.[14 - i] === true);
	const data = (bits ^ 0x5412) >>> 10;
	return { ecLevel: ["M", "L", "H", "Q"][(data >>> 3) & 3] ?? "M", mask: data & 7 };
}

/** The codewords of a symbol, read in the zigzag order of the specification and unmasked. */
function readCodewords(modules: boolean[][]): number[] {
	const size = modules.length;
	const { mask } = readFormat(modules);
	const pattern = MASK_PATTERNS[mask] ?? MASK_PATTERNS[0]!;
	const bits: number[] = [];
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let vertical = 0; vertical < size; vertical++) {
			for (let offset = 0; offset < 2; offset++) {
				const x = right - offset;
				const upward = ((right + 1) & 2) === 0;
				const y = upward ? size - 1 - vertical : vertical;
				if (isFunctionModule(size, x, y)) continue;
				let bit = modules[y]?.[x] === true;
				if (pattern(y, x)) bit = !bit;
				bits.push(bit ? 1 : 0);
			}
		}
	}
	const codewords: number[] = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) {
		let value = 0;
		for (let bit = 0; bit < 8; bit++) value = (value << 1) | bits[i + bit]!;
		codewords.push(value);
	}
	return codewords;
}

/** The data codewords of a symbol, with the interleaving of the error correction blocks undone. */
function readDataCodewords(modules: boolean[][]): number[] {
	const size = modules.length;
	const version = (size - 17) / 4;
	const { ecLevel } = readFormat(modules);
	const codewords = readCodewords(modules);
	const blocks = EC_BLOCKS[ecLevel]?.[version - 1] ?? 1;
	const ecPerBlock = EC_CODEWORDS_PER_BLOCK[ecLevel]?.[version - 1] ?? 0;
	const capacity = codewords.length - blocks * ecPerBlock;
	const shortLength = Math.floor(capacity / blocks);
	const longBlocks = capacity % blocks;
	const lengths: number[] = [];
	for (let block = 0; block < blocks; block++) lengths.push(shortLength + (block >= blocks - longBlocks ? 1 : 0));
	const data: number[][] = lengths.map(() => []);
	let index = 0;
	for (let i = 0; i < shortLength + (longBlocks > 0 ? 1 : 0); i++) {
		for (let block = 0; block < blocks; block++) {
			if (i < lengths[block]!) data[block]!.push(codewords[index++] ?? 0);
		}
	}
	return data.flat();
}

/** The payload of a symbol, decoded from its data codewords. */
function readPayload(modules: boolean[][]): string {
	const size = modules.length;
	const version = (size - 17) / 4;
	const data = readDataCodewords(modules);
	const bits: number[] = [];
	for (const codeword of data) {
		for (let bit = 7; bit >= 0; bit--) bits.push((codeword >> bit) & 1);
	}
	const take = (count: number): number => {
		let value = 0;
		for (let i = 0; i < count; i++) value = (value << 1) | (bits.shift() ?? 0);
		return value;
	};
	const mode = take(4);
	if (mode === 0b0001) {
		const count = take(version <= 9 ? 10 : version <= 26 ? 12 : 14);
		let digits = "";
		while (digits.length < count) {
			const remaining = count - digits.length;
			if (remaining >= 3) digits += take(10).toString().padStart(3, "0");
			else if (remaining === 2) digits += take(7).toString().padStart(2, "0");
			else digits += take(4).toString();
		}
		return digits;
	}
	expect(mode).toBe(0b0100);
	const count = take(version <= 9 ? 8 : 16);
	const bytes: number[] = [];
	for (let i = 0; i < count; i++) bytes.push(take(8));
	return new TextDecoder().decode(new Uint8Array(bytes));
}

/** The finder pattern at the given corner, module by module. */
function finderPattern(modules: boolean[][], offsetX: number, offsetY: number): boolean[][] {
	const pattern: boolean[][] = [];
	for (let dy = 0; dy < 7; dy++) {
		const row: boolean[] = [];
		for (let dx = 0; dx < 7; dx++) row.push(modules[offsetY + dy]?.[offsetX + dx] === true);
		pattern.push(row);
	}
	return pattern;
}

const FINDER_PATTERN = [
	[true, true, true, true, true, true, true],
	[true, false, false, false, false, false, true],
	[true, false, true, true, true, false, true],
	[true, false, true, true, true, false, true],
	[true, false, true, true, true, false, true],
	[true, false, false, false, false, false, true],
	[true, true, true, true, true, true, true],
];

describe("qr encoder", () => {
	it("produces the codewords of the specification's example", () => {
		const modules = encodeQr("01234567", { version: 1, ecLevel: "M" });
		expect(readFormat(modules).ecLevel).toBe("M");
		expect(readDataCodewords(modules)).toEqual(SPECIFICATION_DATA_CODEWORDS);
		const codewords = readCodewords(modules);
		expect(codewords.slice(0, 16)).toEqual(SPECIFICATION_DATA_CODEWORDS);
		expect(codewords.slice(16)).toEqual(SPECIFICATION_EC_CODEWORDS);
		expect(codewords).toHaveLength(26);
	});

	it("encodes the payload in numeric mode when it is only digits", () => {
		const modules = encodeQr("01234567", { version: 1, ecLevel: "M" });
		expect(readPayload(modules)).toBe("01234567");
	});

	it("lays out the function patterns", () => {
		const modules = encodeQr("https://example.com/pair", { version: 4, ecLevel: "Q" });
		const size = modules.length;
		expect(size).toBe(4 * 4 + 17);
		expect(finderPattern(modules, 0, 0)).toEqual(FINDER_PATTERN);
		expect(finderPattern(modules, size - 7, 0)).toEqual(FINDER_PATTERN);
		expect(finderPattern(modules, 0, size - 7)).toEqual(FINDER_PATTERN);
		for (let i = 8; i <= size - 9; i++) {
			expect(modules[6]?.[i]).toBe(i % 2 === 0);
			expect(modules[i]?.[6]).toBe(i % 2 === 0);
		}
		expect(modules[size - 8]?.[8]).toBe(true);
	});

	it("decodes back to the payload", () => {
		const payloads = [
			"a",
			"hello world",
			"01234567",
			`{"code":"abc123","urls":["http://127.0.0.1:4096"]}`,
			"x".repeat(300),
			"9".repeat(1200),
			"grüße aus dem terminal ✓",
		];
		for (const payload of payloads) {
			const modules = encodeQr(payload, { ecLevel: "M" });
			expect(readPayload(modules)).toBe(payload);
		}
	});

	it("picks the version that fits the payload", () => {
		expect(encodeQr("a")).toHaveLength(21);
		expect(encodeQr("a".repeat(200), { ecLevel: "L" })).toHaveLength(4 * 9 + 17);
		expect(() => encodeQr("a".repeat(4000))).toThrow();
		expect(() => encodeQr("a", { version: 2 })).not.toThrow();
		expect(() => encodeQr("a".repeat(100), { version: 1 })).toThrow();
	});

	it("renders the code as half block rows", () => {
		const modules = encodeQr("pair", { ecLevel: "M" });
		const size = modules.length;
		const rows = renderQr("pair", { ecLevel: "M" });
		expect(rows).toHaveLength(4 + Math.ceil(size / 2) + 4);
		for (const row of rows) expect(row).toHaveLength(size + 8);
		expect(rows[0]).toBe(" ".repeat(size + 8));
		expect(rows[rows.length - 1]).toBe(" ".repeat(size + 8));
		for (const row of rows) expect(row).toMatch(/^[ ▀▄█]+$/);
		// The quiet zone frames the code, and the first module row is in the upper half.
		const first = rows[4]!;
		expect(first.slice(0, 4)).toBe("    ");
		expect(first.slice(size + 4)).toBe("    ");
		const upper = modules[0]?.[0] === true;
		const lower = modules[1]?.[0] === true;
		expect(first[4]).toBe(upper && lower ? "█" : upper ? "▀" : lower ? "▄" : " ");
	});

	it("renders the quiet zone the caller asks for", () => {
		const rows = renderQr("pair", { ecLevel: "M", quietZone: 2 });
		const size = encodeQr("pair", { ecLevel: "M" }).length;
		expect(rows).toHaveLength(2 + Math.ceil(size / 2) + 2);
		for (const row of rows) expect(row).toHaveLength(size + 4);
	});
});
