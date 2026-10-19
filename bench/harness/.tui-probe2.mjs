const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const log = (label) => console.log(`${label.padEnd(46)} rss=${rss()}MB`);

log("start");
await import("/Users/gabriel/pi/packages/tui/dist/terminal-image.js");
log("after the tui terminal-image");
await import("/Users/gabriel/pi/packages/tui/dist/colors.js");
log("after the tui colors");
await import("/Users/gabriel/pi/packages/tui/dist/components/editor.js");
log("after the tui editor");
await import("/Users/gabriel/pi/packages/tui/dist/index.js");
log("after the tui barrel");
