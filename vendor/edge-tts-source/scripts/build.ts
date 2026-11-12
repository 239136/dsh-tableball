import { $ } from "bun";
import { rmSync, existsSync } from "node:fs";

let now = new Date();

if (existsSync("bin")) rmSync("bin", { recursive: true });

console.info("Building CLI for all platforms...");
const platforms = [
    "linux-x64",
    "linux-arm64",
    "darwin-arm64",
    "darwin-x64",
    "windows-x64"
];

for (const platform of platforms) {
    await build(platform);
}

async function build(target: string) {
    console.info(`Building CLI for ${target}`);
    await $`bun build src/cli/edge-tts.ts --compile --target=bun --outfile=bin/edge-tts-${target}`;
}

console.info(`Completed in ${new Date().getTime() - now.getTime()}ms`);