/**
 * The port's stand-in for pi's `config.ts`.
 *
 * pi's config module reads its own package directory when it loads, and the
 * embedded host has no package directory: the bundle's location is not the
 * vendored package's. The bundler substitutes this module for pi's, so the
 * paths an extension reads are the port's own — the same agent directory pi
 * uses, and the vendored package's README.
 *
 * The README's path is baked in when the bundle is built, because the
 * vendored tree's location is only known there.
 */

declare const __piPiReadmePath: string;
declare const __piPiPackageDir: string;

export const APP_NAME = "pi";
export const APP_TITLE = "π";
export const PACKAGE_NAME = "@earendil-works/pi-coding-agent";
export const CONFIG_DIR_NAME = ".pi";
export const VERSION = "1.3.0";
export const ENV_AGENT_DIR = "PI_CODING_AGENT_DIR";
export const ENV_SESSION_DIR = "PI_CODING_AGENT_SESSION_DIR";

export const isBunBinary = false;
export const isBunRuntime = (): boolean => false;
export const isBundledNode = false;

export const getAgentDir = (): string => {
	const override = process.env.PI_CODING_AGENT_DIR;
	if (override) return override;
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "/";
	return `${home}/.pi/agent`;
};

export const getPackageDir = (): string => __piPiPackageDir;
export const getReadmePath = (): string => __piPiReadmePath;
export const getPackageJsonPath = (): string => `${__piPiPackageDir}/package.json`;
export const getDocsPath = (): string => `${getAgentDir()}/docs`;
export const getExamplesPath = (): string => `${getAgentDir()}/examples`;
export const getChangelogPath = (): string => `${getAgentDir()}/CHANGELOG.md`;
export const getThemesDir = (): string => `${getAgentDir()}/theme`;
export const getCustomThemesDir = (): string => `${getAgentDir()}/themes`;
export const getExportTemplateDir = (): string => `${getAgentDir()}/templates`;
export const getInteractiveAssetsDir = (): string => `${getAgentDir()}/assets`;
export const getBundledInteractiveAssetPath = (name: string): string =>
	`${getInteractiveAssetsDir()}/${name}`;
export const getBinDir = (): string => `${getAgentDir()}/bin`;
export const getQuickJSWasmPath = (): string => `${getAgentDir()}/quickjs.wasm`;
export const setEmbeddedQuickJSWasmPath = (_path: string): void => undefined;
export const detectInstallMethod = (): string => "unknown";
export const detectInstallChange = (): undefined => undefined;
export const findNodePackageDir = (_startDir: string): string => __piPiPackageDir;
export const getSelfUpdateCommand = (): string => "pi update";
export const getSelfUpdateUnavailableInstruction = (): string =>
	"pi cannot update itself in this installation";
export const getUpdateInstruction = (packageName: string): string =>
	`Run your package manager to update ${packageName}.`;
export const resolveCodemodeWorkerSpecifier = (): undefined => undefined;
export const getCodemodeWorkerSpecifier = (): undefined => undefined;

export default {
	APP_NAME,
	APP_TITLE,
	CONFIG_DIR_NAME,
	ENV_AGENT_DIR,
	ENV_SESSION_DIR,
	PACKAGE_NAME,
	VERSION,
	getAgentDir,
	getPackageDir,
	getReadmePath,
};
