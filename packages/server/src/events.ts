/**
 * The global event feed.
 *
 * One server, one feed: every client sees the same events. Each subscriber has its own
 * bounded queue, so a slow client cannot stall the others. A subscriber that overflows is
 * closed with an explicit error, because dropping frames silently would corrupt the
 * client's view of the session.
 */

/** The error a subscriber receives when its queue overflows. */
export const SUBSCRIBER_OVERFLOW_ERROR = { _tag: "SubscriberOverflowError" } as const;

/** The maximum number of frames a subscriber may fall behind. */
export const SUBSCRIBER_QUEUE_LIMIT = 4096;

/** One published event. */
export interface FeedEvent {
	/** The event type, for example `session.updated`. */
	type: string;
	/** The event payload. */
	data: unknown;
}

/** A live subscription. */
export interface FeedSubscription {
	/** The frames the subscriber has not consumed yet. */
	readonly queue: readonly string[];
	/** Whether the subscription was closed. */
	readonly closed: boolean;
	/** Take the next frame, or `undefined` when the queue is empty. */
	next(): string | undefined;
	/** Close the subscription. */
	close(): void;
}

interface Subscriber {
	queue: string[];
	closed: boolean;
}

/**
 * A publish/subscribe feed with per-subscriber queues.
 */
export class EventFeed {
	private readonly subscribers = new Set<Subscriber>();

	/**
	 * Publish one event to every subscriber.
	 */
	publish(event: FeedEvent): void {
		const frame = `data: ${JSON.stringify({ type: event.type, data: event.data })}\n\n`;
		for (const subscriber of this.subscribers) {
			if (subscriber.closed) continue;
			if (subscriber.queue.length >= SUBSCRIBER_QUEUE_LIMIT) {
				subscriber.queue.push(`data: ${JSON.stringify(SUBSCRIBER_OVERFLOW_ERROR)}\n\n`);
				subscriber.closed = true;
				this.subscribers.delete(subscriber);
				continue;
			}
			subscriber.queue.push(frame);
		}
	}

	/**
	 * Subscribe to the feed.
	 */
	subscribe(): FeedSubscription {
		const subscriber: Subscriber = { queue: [], closed: false };
		const subscribers = this.subscribers;
		this.subscribers.add(subscriber);
		return {
			get queue(): readonly string[] {
				return subscriber.queue;
			},
			get closed(): boolean {
				return subscriber.closed;
			},
			next(): string | undefined {
				return subscriber.queue.shift();
			},
			close(): void {
				subscriber.closed = true;
				subscribers.delete(subscriber);
			},
		};
	}

	/** The number of live subscribers. */
	get subscriberCount(): number {
		return this.subscribers.size;
	}

	/** Close every subscription. */
	closeAll(): void {
		for (const subscriber of this.subscribers) {
			subscriber.closed = true;
		}
		this.subscribers.clear();
	}
}
