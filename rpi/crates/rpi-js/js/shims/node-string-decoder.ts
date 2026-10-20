/**
 * The `node:string_decoder` module the extensions import.
 *
 * The embedded host works with text, so the decoder is a thin wrapper over
 * the platform's own decoder: it turns bytes into a string.
 */

export class StringDecoder {
	private readonly decoder = new TextDecoder();

	write(buffer: Uint8Array): string {
		return this.decoder.decode(buffer, { stream: true });
	}

	end(buffer?: Uint8Array): string {
		return this.decoder.decode(buffer);
	}

	text(buffer: Uint8Array, encoding?: string): string {
		return this.decoder.decode(buffer);
	}
}

export default { StringDecoder };
