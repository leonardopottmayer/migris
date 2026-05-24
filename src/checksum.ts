import { createHash } from "crypto";

export function computeChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
