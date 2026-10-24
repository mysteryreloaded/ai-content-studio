// Deletes the files a Tombstone (issue #57, ADR 0011) leaves behind:
// `GenerationsRepository.finishDelete` already committed the database
// side (Assets gone, the Generation row cleared and flagged), and hands
// back the storage keys it found; this is the only place that actually
// calls `Storage.delete`, so a route never has to know the shape of an
// Asset or Upload row to clean up after one.

import type { Storage } from "../storage/storage.js";
import type { DeletedStorageKeys } from "./repository.js";

export async function deleteStorageFor(
  storage: Storage,
  keys: DeletedStorageKeys,
): Promise<void> {
  for (const asset of keys.assets) {
    await storage.delete(asset.storageKey);
    if (asset.posterKey) await storage.delete(asset.posterKey);
    if (asset.thumbnailKey) await storage.delete(asset.thumbnailKey);
  }
  for (const upload of keys.uploads) {
    await storage.delete(upload.storageKey);
    if (upload.thumbnailKey) await storage.delete(upload.thumbnailKey);
  }
}
