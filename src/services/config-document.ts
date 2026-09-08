import { readFile } from "node:fs/promises";
import { stripJsonComments } from "./jsonc.js";

export interface JsonDocumentOptions {
  jsonc?: boolean;
  invalidMessage: (filePath: string) => string;
}

export interface JsonDocument {
  value: Record<string, unknown>;
  existed: boolean;
}

/** Read an optional object-shaped JSON document with consistent error handling. */
export async function readJsonDocument(
  filePath: string,
  options: JsonDocumentOptions
): Promise<JsonDocument> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(options.jsonc ? stripJsonComments(raw) : raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("root must be an object");
    }
    return { value: parsed as Record<string, unknown>, existed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { value: {}, existed: false };
    }
    throw new Error(options.invalidMessage(filePath));
  }
}
