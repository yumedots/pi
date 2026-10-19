/** Loads the package commands only when they run (see main.ts). */
export const loadPackageManagerCli = () => import("./package-manager-cli.ts");
