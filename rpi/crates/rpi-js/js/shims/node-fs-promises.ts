import { promises } from "./node-fs.ts";

export const readFile = promises.readFile;
export const writeFile = promises.writeFile;
export const exists = promises.exists;
export const readdir = promises.readdir;
export const stat = promises.stat;

export default { readFile, writeFile, exists, readdir, stat };
