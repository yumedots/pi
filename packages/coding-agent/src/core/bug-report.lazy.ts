/** Loads the bug report summarizer only when a bug report is written (see agent-session.ts). */
export const loadBugReport = () => import("./bug-report.ts");
