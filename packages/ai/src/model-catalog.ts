import type {
	Api,
	ClassifierApi,
	ClassifierModel,
	ImageApi,
	ImageModel,
	Model,
	ModelType,
	ProviderId,
} from "./types.ts";

export type ModelGroups = Record<string, Record<string, object>>;

type ModelKey<TGroups extends ModelGroups> = {
	[TApi in keyof TGroups]: keyof TGroups[TApi];
}[keyof TGroups] &
	string;

type KeyForType<TGroups extends ModelGroups, TType extends ModelType> = Extract<
	ModelKey<TGroups>,
	`${TType}:${string}`
>;

type ModelId<TKey extends string> = TKey extends `${ModelType}:${infer TModelId}` ? TModelId : never;

type ApiForKey<TGroups extends ModelGroups, TKey extends ModelKey<TGroups>> = {
	[TApi in keyof TGroups]: TKey extends keyof TGroups[TApi] ? TApi : never;
}[keyof TGroups];

export type ChatModelCatalog<TGroups extends ModelGroups, TProvider extends ProviderId> = {
	[TKey in KeyForType<TGroups, "chat"> as ModelId<TKey>]: Model<ApiForKey<TGroups, TKey> & Api> & {
		id: ModelId<TKey>;
		provider: TProvider;
	};
};

export type ImageModelCatalog<TGroups extends ModelGroups, TProvider extends ProviderId> = {
	[TKey in KeyForType<TGroups, "image"> as ModelId<TKey>]: ImageModel<ApiForKey<TGroups, TKey> & ImageApi> & {
		id: ModelId<TKey>;
		provider: TProvider;
	};
};

export type ClassifierModelCatalog<TGroups extends ModelGroups, TProvider extends ProviderId> = {
	[TKey in KeyForType<TGroups, "classifier"> as ModelId<TKey>]: ClassifierModel<
		ApiForKey<TGroups, TKey> & ClassifierApi
	> & {
		id: ModelId<TKey>;
		provider: TProvider;
	};
};

function flattenModelCatalog(groups: ModelGroups, type: ModelType): Record<string, object> {
	return Object.fromEntries(
		Object.values(groups)
			.flatMap((models) => Object.values(models))
			.filter((model) => (model as { type?: unknown }).type === type)
			.map((model) => [(model as { id: string }).id, model]),
	);
}

export function flattenChatModelCatalog<const TProvider extends ProviderId, const TGroups extends ModelGroups>(
	_provider: TProvider,
	groups: TGroups,
): ChatModelCatalog<TGroups, TProvider> {
	return flattenModelCatalog(groups, "chat") as ChatModelCatalog<TGroups, TProvider>;
}

export function flattenImageModelCatalog<const TProvider extends ProviderId, const TGroups extends ModelGroups>(
	_provider: TProvider,
	groups: TGroups,
): ImageModelCatalog<TGroups, TProvider> {
	return flattenModelCatalog(groups, "image") as ImageModelCatalog<TGroups, TProvider>;
}

export function flattenClassifierModelCatalog<const TProvider extends ProviderId, const TGroups extends ModelGroups>(
	_provider: TProvider,
	groups: TGroups,
): ClassifierModelCatalog<TGroups, TProvider> {
	return flattenModelCatalog(groups, "classifier") as ClassifierModelCatalog<TGroups, TProvider>;
}

/**
 * Defers building a model catalog until something reads it.
 *
 * Flattening the generated catalogs is the largest allocation the agent makes at
 * startup, and a session that never asks a provider for its models should not pay for
 * it. The proxy materializes the catalog on the first access and then behaves like
 * the plain object.
 */
export function lazyCatalog<TCatalog extends object>(build: () => TCatalog): TCatalog {
	let catalog: TCatalog | undefined;
	const materialize = (): TCatalog => {
		if (!catalog) catalog = build();
		return catalog;
	};
	return new Proxy({} as TCatalog, {
		get: (_target, property, receiver) => Reflect.get(materialize(), property, receiver),
		has: (_target, property) => Reflect.has(materialize(), property),
		ownKeys: () => Reflect.ownKeys(materialize()),
		getOwnPropertyDescriptor: (_target, property) => {
			const descriptor = Reflect.getOwnPropertyDescriptor(materialize(), property);
			return descriptor ? { ...descriptor, configurable: true } : undefined;
		},
		set: (_target, property, value) => Reflect.set(materialize(), property, value),
		deleteProperty: (_target, property) => Reflect.deleteProperty(materialize(), property),
	});
}
