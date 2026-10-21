import type { ApiKeyAuth, AuthCheck, OAuthAuth } from "@earendil-works/pi-ai";
import { theme } from "../theme/theme.ts";
import { MenuComponent, type MenuItem } from "./menu.ts";

export type AuthSelectorProvider = {
	id: string;
	name: string;
	authType: "oauth" | "api_key";
	method?: ApiKeyAuth | OAuthAuth;
	status?: AuthCheck;
	/**
	 * Whether the provider's OAuth sign-in is backed by a subscription. `false` labels it as an account;
	 * unset keeps the "subscription" label.
	 */
	subscription?: boolean;
};

export function formatAuthSelectorProviderType(
	authType: AuthSelectorProvider["authType"],
	subscription?: boolean,
): string {
	if (authType === "api_key") return "API key";
	return subscription === false ? "account" : "subscription";
}

/** Themed suffix describing whether and how a login option is configured, for example " ✓ configured". */
export function formatAuthSelectorProviderStatus(provider: AuthSelectorProvider): string {
	if (!provider.status) return theme.fg("muted", " • not configured");
	if (provider.status.type !== provider.authType) {
		const label = `${formatAuthSelectorProviderType(provider.status.type, provider.subscription)} configured`;
		return theme.fg("muted", " • ") + theme.fg("warning", label);
	}
	if (
		!provider.status.source ||
		provider.status.source === "OAuth" ||
		provider.status.source === "stored credential"
	) {
		return theme.fg("success", " ✓ configured");
	}
	const source = /^[A-Z][A-Z0-9_]*(?:, [A-Z][A-Z0-9_]*)*$/.test(provider.status.source)
		? `env: ${provider.status.source}`
		: provider.status.source;
	return theme.fg("success", ` ✓ ${source}`);
}

/**
 * Component that renders an auth provider selector
 */
export class OAuthSelectorComponent extends MenuComponent<AuthSelectorProvider> {
	private readonly mode: "login" | "logout";

	constructor(
		mode: "login" | "logout",
		providers: AuthSelectorProvider[],
		onSelect: (providerId: string, authType: AuthSelectorProvider["authType"]) => void,
		onCancel: () => void,
		initialSearchInput?: string,
	) {
		const showAuthTypeLabels = new Set(providers.map((provider) => provider.authType)).size > 1;
		const items: MenuItem<AuthSelectorProvider>[] = providers.map((provider) => {
			const authTypeLabel = showAuthTypeLabels
				? ` [${formatAuthSelectorProviderType(provider.authType, provider.subscription)}]`
				: "";
			return {
				title: provider.name,
				description: `${authTypeLabel}${formatAuthSelectorProviderStatus(provider)}`,
				value: provider,
			};
		});
		super(
			{
				title: mode === "login" ? "Select provider to configure:" : "Select provider to logout:",
				items,
				placeholder: "Search",
			},
			(provider) => onSelect(provider.id, provider.authType),
			onCancel,
		);
		this.mode = mode;
		if (initialSearchInput) {
			this.searchInput.setValue(initialSearchInput);
			this.applyFilter(initialSearchInput);
		}
	}

	protected override emptyText(): string {
		if (this.getAllItems().length > 0) return "No matching providers";
		return this.mode === "login" ? "No providers available" : "No providers logged in. Use /login first.";
	}

	/** Matches the provider name, id, auth type and method name. */
	protected override applyFilter(query: string): void {
		const trimmed = query.trim();
		const all = this.getAllItems();
		this.visibleItems = trimmed
			? all.filter((item) =>
					`${item.value.name} ${item.value.id} ${item.value.authType} ${item.value.method?.name ?? ""}`
						.toLowerCase()
						.includes(trimmed.toLowerCase()),
				)
			: all;
		this.getSelectList().setItems(this.toRows(this.visibleItems));
		this.renderContent();
	}
}
