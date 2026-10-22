/**
 * The configuration of the client.
 *
 * The configuration is shared with the coding agent: the paths of the agent directory, the
 * name of the application and the version come from the package.json of the package that
 * owns the running code, and that is this package.
 */

import { createPackageIdentity, findNodePackageDir } from "@earendil-works/pi-support/config";
import { dirname } from "path";
import { fileURLToPath } from "url";

export * from "@earendil-works/pi-support/config";

const identity = createPackageIdentity(findNodePackageDir(dirname(fileURLToPath(import.meta.url))));

export const {
	PACKAGE_NAME,
	APP_NAME,
	APP_TITLE,
	CONFIG_DIR_NAME,
	VERSION,
	ENV_AGENT_DIR,
	ENV_SESSION_DIR,
	getPackageDir,
	getThemesDir,
	getExportTemplateDir,
	getPackageJsonPath,
	getReadmePath,
	getDocsPath,
	getExamplesPath,
	getChangelogPath,
	getAgentDir,
	getCustomThemesDir,
	getModelsPath,
	getAuthPath,
	getSettingsPath,
	getToolsDir,
	getBinDir,
	getPromptsDir,
	getSessionsDir,
	getDebugLogPath,
	getSelfInstallManifestPath,
	readSelfInstallManifest,
	detectInstallChange,
	getSelfUpdateOwner,
} = identity;
