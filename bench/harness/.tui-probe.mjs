const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const log = (label) => console.log(`${label.padEnd(46)} rss=${rss()}MB`);

log("start");
await import("/Users/gabriel/pi/packages/tui/dist/colors.js");
log("after the tui colors");
await import("/Users/gabriel/pi/packages/tui/dist/terminal-colors.js");
log("after the tui terminal colors");
await import("/Users/gabriel/pi/packages/tui/dist/index.js");
log("after the tui barrel");
