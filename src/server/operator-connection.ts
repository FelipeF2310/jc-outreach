import { postgresOptions } from "./postgres";

/** Build an owner connection in memory; never put the password in argv or logs. */
export function operatorConnection(
  template: string,
  projectUrl: string,
  password: string,
  ca: string,
) {
  const project = new URL(projectUrl);
  const connection = new URL(template);
  const reference = project.hostname.split(".")[0];
  if (
    project.protocol !== "https:" ||
    !/^[a-z0-9]+\.supabase\.co$/.test(project.hostname) ||
    connection.protocol !== "postgresql:" ||
    !/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(connection.hostname) ||
    connection.port !== "5432" ||
    connection.pathname !== "/postgres" ||
    connection.username !== `postgres.${reference}` ||
    decodeURIComponent(connection.password) !== "[YOUR-PASSWORD]" ||
    connection.search ||
    connection.hash ||
    !password ||
    Buffer.byteLength(password) > 4096 ||
    /[\r\n\0]/.test(password) ||
    !ca.includes("-----BEGIN CERTIFICATE-----")
  )
    throw new Error("Invalid operator connection configuration.");
  connection.password = encodeURIComponent(password);
  return postgresOptions(connection.href, ca);
}

export async function readOperatorPassword(input: AsyncIterable<Uint8Array>) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    size += chunk.length;
    if (size > 4096) throw new Error("Invalid operator input.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
