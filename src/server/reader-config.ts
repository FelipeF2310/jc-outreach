import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { operatorConnection } from "./operator-connection";

export function readerConfiguration(
  source: string,
  template: string,
  password: string,
  ca: string,
) {
  const env = parseEnv(source);
  if (
    env.JCO_HOSTED_STAGE !== "synthetic-preview" ||
    env.JCO_SYNTHETIC_ONLY === "1"
  )
    throw new Error("Synthetic hosted configuration required.");
  // Reuse the validated owner template, but never put an owner credential in it.
  const options = operatorConnection(
    template,
    env.JCO_SUPABASE_URL ?? "",
    password,
    ca,
  );
  const url = new URL(options.connectionString!);
  url.username = url.username.replace(/^postgres\./, "jco_admin_reader.");
  const values = { DATABASE_URL: url.href, JCO_DATABASE_CA: ca.trim() };
  let result = source;
  for (const [key, value] of Object.entries(values)) {
    // Only fill the two literal blank placeholders. Refuse existing credentials,
    // duplicate keys, export syntax, and ambiguous/multiline declarations.
    const declarations = source.match(
      new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`, "gm"),
    );
    const blank = new RegExp(`^${key}=[ \\t]*\\r?$`, "m");
    if (declarations?.length !== 1 || env[key] || !blank.test(source))
      throw new Error(
        "Database settings are not empty placeholders. Nothing replaced.",
      );
    if (/["\\$\0]/.test(value))
      throw new Error("Unsupported configuration encoding.");
    result = result.replace(blank, () => `${key}="${value}"`);
  }
  return {
    source: result,
    connectionString: url.href,
    ca: values.JCO_DATABASE_CA,
  };
}

export async function readPrivateConfiguration(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.uid !== process.getuid?.()
    )
      throw new Error("Configuration must be an owner-only regular file.");
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}

/** Atomic replacement, no retained backup, and no replacement after a concurrent edit. */
export async function savePrivateConfiguration(
  path: string,
  previous: string,
  next: string,
) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  let installed = false;
  try {
    await file.writeFile(next, "utf8");
    await file.sync();
    if ((await readPrivateConfiguration(path)) !== previous)
      throw new Error("Configuration changed during setup. Nothing replaced.");
    await rename(temporary, path);
    installed = true;
  } finally {
    await file.close();
    if (!installed) await unlink(temporary);
  }
}
