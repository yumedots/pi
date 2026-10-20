const rss = () => Math.round(process.memoryUsage().rss / 1048576);
console.log("start", rss(), "MB");
await import("/Users/gabriel/pi/packages/ai/dist/providers/all.js");
console.log("after the provider SDKs", rss(), "MB");
