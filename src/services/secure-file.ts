import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function writeSecureFile(
  filePath: string,
  content: string,
  options: { secureParent?: boolean } = {}
): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (options.secureParent !== false) await chmod(directory, 0o700);

  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, filePath);
  await chmod(filePath, 0o600);
}
