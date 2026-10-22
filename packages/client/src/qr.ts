/**
 * A self-contained QR encoder (ISO/IEC 18004).
 *
 * The terminal prints pairing codes as QR codes, so the encoder lives here
 * instead of in a dependency: no WASM, no network, nothing to install.
 *
 * The encoder follows the specification: byte mode and numeric mode for the
 * payload, the Reed-Solomon error correction blocks of the specification's
 * tables, the BCH encoded format and version information, the eight mask
 * patterns and the four penalty rules that pick the mask.
 */

/** The error correction levels of the QR spec. */
export type QrEcLevel = "L" | "M" | "Q" | "H";

/** The data modes the encoder can use. */
type QrMode = "auto" | "byte" | "numeric";

/** The modes that carry a payload. */
type QrDataMode = "byte" | "numeric";

/** The mode indicator of each data mode. */
const MODE_INDICATOR: Record<QrDataMode, number> = { byte: 0b0100, numeric: 0b0001 };

/** The two bits that identify the error correction level in the format information. */
const EC_LEVEL_INDICATOR: Record<QrEcLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/** The error correction codewords per block, indexed by level and then by version. */
const ECC_CODEWORDS_PER_BLOCK: Record<QrEcLevel, readonly number[]> = {
	L: [
		7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30,
		30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
	],
	M: [
		10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28,
		28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
	],
	Q: [
		13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30,
		30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
	],
	H: [
		17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30,
		30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
	],
};

/** The number of error correction blocks, indexed by level and then by version. */
const NUM_ERROR_CORRECTION_BLOCKS: Record<QrEcLevel, readonly number[]> = {
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

/** The modules of a symbol, with the function modules marked. */
interface QrSymbol {
	readonly size: number;
	readonly modules: boolean[][];
	readonly isFunction: boolean[][];
}

/**
 * Encode a string as a QR code.
 *
 * The payload goes into numeric mode when it is only digits and into byte mode
 * otherwise; `mode` forces one of the two. The version is the smallest that holds
 * the payload, up to version 40.
 *
 * @returns The modules, `true` for a dark module. The size is `4 * version + 17`.
 */
export function encodeQr(
	text: string,
	options?: { version?: number; ecLevel?: QrEcLevel; mode?: QrMode },
): boolean[][] {
	const ecLevel = options?.ecLevel ?? "M";
	const requestedMode = options?.mode ?? "auto";
	const mode: QrDataMode =
		requestedMode === "byte" || requestedMode === "numeric"
			? requestedMode
			: text.length > 0 && /^[0-9]+$/.test(text)
				? "numeric"
				: "byte";
	const version = chooseVersion(text, mode, ecLevel, options?.version);
	const codewords = buildCodewords(text, mode, version, ecLevel);
	const size = 4 * version + 17;
	const symbol: QrSymbol = {
		size,
		modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
		isFunction: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
	};
	drawFunctionPatterns(symbol, version, ecLevel);
	placeCodewords(symbol, codewords);
	let bestMask = 0;
	let bestPenalty = Number.POSITIVE_INFINITY;
	for (let mask = 0; mask < 8; mask++) {
		applyMask(symbol, mask);
		drawFormatBits(symbol, mask, ecLevel);
		const penalty = penaltyScore(symbol);
		if (penalty < bestPenalty) {
			bestPenalty = penalty;
			bestMask = mask;
		}
		applyMask(symbol, mask);
	}
	applyMask(symbol, bestMask);
	drawFormatBits(symbol, bestMask, ecLevel);
	return symbol.modules;
}

/**
 * Render a QR code as text rows.
 *
 * Each row uses the half-block characters, so two module rows fit in one text row:
 * an upper dark module is `▀`, a lower dark module is `▄`, both are `█`, neither is a space.
 */
export function renderQr(text: string, options?: { ecLevel?: QrEcLevel; quietZone?: number }): string[] {
	const quietZone = options?.quietZone ?? 4;
	const modules = encodeQr(text, { ecLevel: options?.ecLevel ?? "M" });
	const size = modules.length;
	const width = size + quietZone * 2;
	const rows: string[] = [];
	for (let i = 0; i < quietZone; i++) rows.push(" ".repeat(width));
	for (let row = 0; row < size; row += 2) {
		const upper = modules[row] ?? [];
		const lower = modules[row + 1];
		let line = "";
		for (let column = 0; column < size; column++) {
			const top = upper[column] === true;
			const bottom = lower?.[column] === true;
			line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
		}
		rows.push(" ".repeat(quietZone) + line + " ".repeat(quietZone));
	}
	for (let i = 0; i < quietZone; i++) rows.push(" ".repeat(width));
	return rows;
}

/** The number of bits the character count indicator takes. */
function countBits(version: number, mode: QrDataMode): number {
	if (mode === "byte") return version <= 9 ? 8 : 16;
	return version <= 9 ? 10 : version <= 26 ? 12 : 14;
}

/** The number of payload bits the text takes in the given mode. */
function payloadBits(text: string, mode: QrDataMode): number {
	if (mode === "numeric") {
		const digits = text.length;
		const groups = Math.floor(digits / 3);
		const rest = digits % 3;
		return groups * 10 + (rest === 0 ? 0 : rest === 1 ? 4 : 7);
	}
	return new TextEncoder().encode(text).length * 8;
}

/** The number of codewords a version holds, data and error correction together. */
function totalCodewords(version: number): number {
	let modules = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const alignmentCount = Math.floor(version / 7) + 2;
		modules -= (25 * alignmentCount - 10) * alignmentCount - 55;
		if (version >= 7) modules -= 36;
	}
	return Math.floor(modules / 8);
}

/** The number of data codewords a version holds at the given error correction level. */
function dataCodewordCount(version: number, ecLevel: QrEcLevel): number {
	const blocks = NUM_ERROR_CORRECTION_BLOCKS[ecLevel][version - 1] ?? 0;
	const ecCodewords = ECC_CODEWORDS_PER_BLOCK[ecLevel][version - 1] ?? 0;
	return totalCodewords(version) - blocks * ecCodewords;
}

/** The version that holds the payload, the smallest one when none is requested. */
function chooseVersion(text: string, mode: QrDataMode, ecLevel: QrEcLevel, requested?: number): number {
	if (requested !== undefined) {
		if (!Number.isInteger(requested) || requested < 1 || requested > 40) {
			throw new Error(`Unsupported QR version ${requested}`);
		}
		const needed = 4 + countBits(requested, mode) + payloadBits(text, mode);
		if (needed > dataCodewordCount(requested, ecLevel) * 8) {
			throw new Error(`The payload does not fit into a version ${requested} QR code at level ${ecLevel}`);
		}
		return requested;
	}
	for (let version = 1; version <= 40; version++) {
		const needed = 4 + countBits(version, mode) + payloadBits(text, mode);
		if (needed <= dataCodewordCount(version, ecLevel) * 8) return version;
	}
	throw new Error("The payload is too long for a QR code");
}

/** The payload as a stream of bits, without the terminator and the padding. */
function encodePayload(text: string, mode: QrDataMode, version: number): number[] {
	const bits: number[] = [];
	const push = (value: number, length: number): void => {
		for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
	};
	push(MODE_INDICATOR[mode], 4);
	if (mode === "numeric") {
		push(text.length, countBits(version, mode));
		for (let i = 0; i < text.length; i += 3) {
			const group = text.slice(i, i + 3);
			push(Number(group), group.length * 3 + 1);
		}
		return bits;
	}
	const bytes = new TextEncoder().encode(text);
	push(bytes.length, countBits(version, mode));
	for (const byte of bytes) push(byte, 8);
	return bits;
}

/** The final message: the data codewords and the error correction codewords, interleaved. */
function buildCodewords(text: string, mode: QrDataMode, version: number, ecLevel: QrEcLevel): Uint8Array {
	const bits = encodePayload(text, mode, version);
	const capacity = dataCodewordCount(version, ecLevel);
	const blocks = NUM_ERROR_CORRECTION_BLOCKS[ecLevel][version - 1] ?? 0;
	const ecPerBlock = ECC_CODEWORDS_PER_BLOCK[ecLevel][version - 1] ?? 0;

	const dataCodewords = new Uint8Array(capacity);
	const payloadBytes = Math.ceil((bits.length + 4) / 8);
	for (let i = 0; i < payloadBytes; i++) {
		let value = 0;
		for (let bit = 0; bit < 8; bit++) {
			const index = i * 8 + bit;
			value = (value << 1) | (index < bits.length ? (bits[index] ?? 0) : 0);
		}
		dataCodewords[i] = value;
	}
	for (let i = payloadBytes; i < capacity; i++) {
		dataCodewords[i] = (i - payloadBytes) % 2 === 0 ? 0xec : 0x11;
	}

	const shortLength = Math.floor(capacity / blocks);
	const longBlocks = capacity % blocks;
	const blockData: Uint8Array[] = [];
	let offset = 0;
	for (let block = 0; block < blocks; block++) {
		const length = shortLength + (block >= blocks - longBlocks ? 1 : 0);
		blockData.push(dataCodewords.subarray(offset, offset + length));
		offset += length;
	}

	const divisor = rsDivisor(ecPerBlock);
	const blockEc = blockData.map((block) => rsRemainder(block, divisor));

	const result = new Uint8Array(totalCodewords(version));
	let index = 0;
	for (let i = 0; i < shortLength + (longBlocks > 0 ? 1 : 0); i++) {
		for (const block of blockData) {
			if (i < block.length) result[index++] = block[i] ?? 0;
		}
	}
	for (let i = 0; i < ecPerBlock; i++) {
		for (const block of blockEc) result[index++] = block[i] ?? 0;
	}
	return result;
}

/** The logarithm table of the Galois field the Reed-Solomon code works in. */
const GF_LOG = new Uint8Array(256);

/** The exponent table of the Galois field the Reed-Solomon code works in. */
const GF_EXP = new Uint8Array(512);

{
	let value = 1;
	for (let i = 0; i < 255; i++) {
		GF_EXP[i] = value;
		GF_LOG[value] = i;
		value <<= 1;
		if (value & 0x100) value ^= 0x11d;
	}
	for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255] ?? 0;
}

/** Multiply two numbers in the Galois field. */
function gfMultiply(a: number, b: number): number {
	if (a === 0 || b === 0) return 0;
	return GF_EXP[(GF_LOG[a] ?? 0) + (GF_LOG[b] ?? 0)] ?? 0;
}

/** The Reed-Solomon generator polynomial of the given degree. */
function rsDivisor(degree: number): Uint8Array {
	const result = new Uint8Array(degree);
	result[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < degree; j++) {
			result[j] = gfMultiply(result[j] ?? 0, root);
			if (j + 1 < degree) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
		}
		root = gfMultiply(root, 2);
	}
	return result;
}

/** The Reed-Solomon error correction codewords of a block. */
function rsRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
	const result = new Uint8Array(divisor.length);
	for (const byte of data) {
		const factor = byte ^ (result[0] ?? 0);
		result.copyWithin(0, 1);
		result[result.length - 1] = 0;
		for (let i = 0; i < result.length; i++) result[i] = (result[i] ?? 0) ^ gfMultiply(divisor[i] ?? 0, factor);
	}
	return result;
}

/** Set a module that belongs to a function pattern. */
function setFunctionModule(symbol: QrSymbol, x: number, y: number, isDark: boolean): void {
	const row = symbol.modules[y];
	const functionRow = symbol.isFunction[y];
	if (!row || !functionRow) return;
	row[x] = isDark;
	functionRow[x] = true;
}

/** The centers of the alignment patterns of a version. */
function alignmentPositions(version: number): number[] {
	if (version === 1) return [];
	const count = Math.floor(version / 7) + 2;
	const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
	const positions = [6];
	for (let position = 4 * version + 10; positions.length < count; position -= step) positions.splice(1, 0, position);
	return positions;
}

/** Draw the finder patterns with their separators. */
function drawFinderPattern(symbol: QrSymbol, centerX: number, centerY: number): void {
	for (let dy = -4; dy <= 4; dy++) {
		for (let dx = -4; dx <= 4; dx++) {
			const x = centerX + dx;
			const y = centerY + dy;
			if (x < 0 || x >= symbol.size || y < 0 || y >= symbol.size) continue;
			const distance = Math.max(Math.abs(dx), Math.abs(dy));
			setFunctionModule(symbol, x, y, distance !== 2 && distance !== 4);
		}
	}
}

/** Draw an alignment pattern. */
function drawAlignmentPattern(symbol: QrSymbol, centerX: number, centerY: number): void {
	for (let dy = -2; dy <= 2; dy++) {
		for (let dx = -2; dx <= 2; dx++) {
			const distance = Math.max(Math.abs(dx), Math.abs(dy));
			setFunctionModule(symbol, centerX + dx, centerY + dy, distance !== 1);
		}
	}
}

/** Draw the format information of the given mask. */
function drawFormatBits(symbol: QrSymbol, mask: number, ecLevel: QrEcLevel): void {
	const data = (EC_LEVEL_INDICATOR[ecLevel] << 3) | mask;
	let remainder = data;
	for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
	const bits = ((data << 10) | remainder) ^ 0x5412;
	for (let i = 0; i <= 5; i++) setFunctionModule(symbol, 8, i, bitAt(bits, i));
	setFunctionModule(symbol, 8, 7, bitAt(bits, 6));
	setFunctionModule(symbol, 8, 8, bitAt(bits, 7));
	setFunctionModule(symbol, 7, 8, bitAt(bits, 8));
	for (let i = 9; i < 15; i++) setFunctionModule(symbol, 14 - i, 8, bitAt(bits, i));
	for (let i = 0; i < 8; i++) setFunctionModule(symbol, symbol.size - 1 - i, 8, bitAt(bits, i));
	for (let i = 8; i < 15; i++) setFunctionModule(symbol, 8, symbol.size - 15 + i, bitAt(bits, i));
	setFunctionModule(symbol, 8, symbol.size - 8, true);
}

/** Draw the version information of the versions that carry it. */
function drawVersionBits(symbol: QrSymbol, version: number): void {
	let remainder = version;
	for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
	const bits = (version << 12) | remainder;
	for (let i = 0; i < 18; i++) {
		const isDark = bitAt(bits, i);
		const a = symbol.size - 11 + (i % 3);
		const b = Math.floor(i / 3);
		setFunctionModule(symbol, a, b, isDark);
		setFunctionModule(symbol, b, a, isDark);
	}
}

/** Draw every function pattern of the symbol. */
function drawFunctionPatterns(symbol: QrSymbol, version: number, ecLevel: QrEcLevel): void {
	for (let i = 0; i < symbol.size; i++) {
		setFunctionModule(symbol, 6, i, i % 2 === 0);
		setFunctionModule(symbol, i, 6, i % 2 === 0);
	}
	drawFinderPattern(symbol, 3, 3);
	drawFinderPattern(symbol, symbol.size - 4, 3);
	drawFinderPattern(symbol, 3, symbol.size - 4);
	const positions = alignmentPositions(version);
	for (let i = 0; i < positions.length; i++) {
		for (let j = 0; j < positions.length; j++) {
			const last = positions.length - 1;
			if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
			drawAlignmentPattern(symbol, positions[i] ?? 0, positions[j] ?? 0);
		}
	}
	drawFormatBits(symbol, 0, ecLevel);
	if (version >= 7) drawVersionBits(symbol, version);
}

/** Place the codewords in the symbol, in the zigzag order of the specification. */
function placeCodewords(symbol: QrSymbol, codewords: Uint8Array): void {
	let bitIndex = 0;
	for (let right = symbol.size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let vertical = 0; vertical < symbol.size; vertical++) {
			for (let offset = 0; offset < 2; offset++) {
				const x = right - offset;
				const upward = ((right + 1) & 2) === 0;
				const y = upward ? symbol.size - 1 - vertical : vertical;
				if (symbol.isFunction[y]?.[x] === true) continue;
				if (bitIndex >= codewords.length * 8) continue;
				symbol.modules[y]![x] = bitAt(codewords[bitIndex >>> 3] ?? 0, 7 - (bitIndex & 7));
				bitIndex++;
			}
		}
	}
}

/** Flip the data modules the mask pattern covers. */
function applyMask(symbol: QrSymbol, mask: number): void {
	const pattern = MASK_PATTERNS[mask];
	if (!pattern) return;
	for (let y = 0; y < symbol.size; y++) {
		for (let x = 0; x < symbol.size; x++) {
			if (symbol.isFunction[y]?.[x] === true) continue;
			if (pattern(y, x)) symbol.modules[y]![x] = !symbol.modules[y]![x];
		}
	}
}

/** Record a run of modules in the run history of the finder pattern rule. */
function addRunHistory(runLength: number, history: number[], size: number): void {
	if (history[0] === 0) runLength += size;
	history.pop();
	history.unshift(runLength);
}

/** The finder patterns of the 1:1:3:1:1 rule that end with the given run history. */
function countFinderPatterns(history: number[]): number {
	const n = history[1] ?? 0;
	const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
	return (
		(core && (history[0] ?? 0) >= n * 4 && (history[6] ?? 0) >= n ? 1 : 0) +
		(core && (history[6] ?? 0) >= n * 4 && (history[0] ?? 0) >= n ? 1 : 0)
	);
}

/** The finder patterns of the 1:1:3:1:1 rule at the end of a row or column. */
function terminateAndCount(runColor: boolean, runLength: number, history: number[], size: number): number {
	let length = runLength;
	if (runColor) {
		addRunHistory(length, history, size);
		length = 0;
	}
	length += size;
	addRunHistory(length, history, size);
	return countFinderPatterns(history);
}

/** The penalty of a symbol, the four rules of the specification added up. */
function penaltyScore(symbol: QrSymbol): number {
	let result = 0;
	for (let y = 0; y < symbol.size; y++) {
		let runColor = false;
		let runLength = 0;
		const history = [0, 0, 0, 0, 0, 0, 0];
		for (let x = 0; x < symbol.size; x++) {
			if ((symbol.modules[y]?.[x] ?? false) === runColor) {
				runLength++;
				if (runLength === 5) result += 3;
				else if (runLength > 5) result++;
			} else {
				addRunHistory(runLength, history, symbol.size);
				if (!runColor) result += countFinderPatterns(history) * 40;
				runColor = symbol.modules[y]?.[x] ?? false;
				runLength = 1;
			}
		}
		result += terminateAndCount(runColor, runLength, history, symbol.size) * 40;
	}
	for (let x = 0; x < symbol.size; x++) {
		let runColor = false;
		let runLength = 0;
		const history = [0, 0, 0, 0, 0, 0, 0];
		for (let y = 0; y < symbol.size; y++) {
			if ((symbol.modules[y]?.[x] ?? false) === runColor) {
				runLength++;
				if (runLength === 5) result += 3;
				else if (runLength > 5) result++;
			} else {
				addRunHistory(runLength, history, symbol.size);
				if (!runColor) result += countFinderPatterns(history) * 40;
				runColor = symbol.modules[y]?.[x] ?? false;
				runLength = 1;
			}
		}
		result += terminateAndCount(runColor, runLength, history, symbol.size) * 40;
	}
	for (let y = 0; y < symbol.size - 1; y++) {
		for (let x = 0; x < symbol.size - 1; x++) {
			const color = symbol.modules[y]?.[x] ?? false;
			if (
				color === (symbol.modules[y]?.[x + 1] ?? false) &&
				color === (symbol.modules[y + 1]?.[x] ?? false) &&
				color === (symbol.modules[y + 1]?.[x + 1] ?? false)
			) {
				result += 3;
			}
		}
	}
	let dark = 0;
	for (const row of symbol.modules) {
		for (const isDark of row) if (isDark) dark++;
	}
	const total = symbol.size * symbol.size;
	result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
	return result;
}

/** The bit of a number at the given index, the least significant bit first. */
function bitAt(value: number, index: number): boolean {
	return ((value >>> index) & 1) === 1;
}
