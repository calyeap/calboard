// scripts/evidence/archive.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Zips the capture directory.
 *
 * PowerShell's Compress-Archive rather than an archiver dependency: it is
 * present on this platform, and the archive is a delivery detail rather than
 * something worth adding a package for.
 */
export async function zipDirectory(dir: string, zipPath: string): Promise<void> {
  await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Compress-Archive -Path '${dir}\\*' -DestinationPath '${zipPath}' -Force`,
  ]);
}
