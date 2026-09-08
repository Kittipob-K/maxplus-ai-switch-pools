import { homedir } from "node:os";
import { join } from "node:path";
import { writeSecureFile } from "./secure-file.js";
import type { AgentPreparationInput } from "../types.js";

export class GeminiConfigService {
  async apply(input: AgentPreparationInput): Promise<string[]> {
    const dir = join(homedir(), ".gemini");
    const envPath = join(dir, ".env");
    const settingsPath = join(dir, "settings.json");
    const base = `${input.endpoint.replace(/\/+$/, "")}/gemini-vip`;
    await writeSecureFile(envPath, `GEMINI_API_KEY=${input.apiKey}\nGOOGLE_API_KEY=${input.apiKey}\nGEMINI_MODEL=${input.selected}\nGOOGLE_GEMINI_BASE_URL=${base}\n`);
    await writeSecureFile(settingsPath, JSON.stringify({ security: { auth: { selectedType: "gemini-api-key" } } }, null, 2) + "\n");
    return [envPath, settingsPath];
  }
}
