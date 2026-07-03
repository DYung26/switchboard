import type { SessionSnapshotData, StorageMechanism } from "@/types";

export interface StorageCollector<TMechanism extends StorageMechanism> {
  readonly mechanism: TMechanism;
  collect(origin: string, tabId: number): Promise<SessionSnapshotData[TMechanism]>;
  clear(origin: string, tabId: number): Promise<void>;
  restore(
    origin: string,
    tabId: number,
    data: SessionSnapshotData[TMechanism],
  ): Promise<void>;
  /**
   * Optional capability check. Collectors that talk to browser APIs that
   * aren't universally available (IndexedDB, Cache Storage) implement this
   * so callers can find out ahead of time whether the mechanism is usable
   * in the given tab. Collectors for APIs that are always available
   * (cookies, web storage) can omit it - the absence of `isSupported` is
   * treated as "always supported".
   *
   * Collectors are expected to honor this themselves: `collect`/`clear`/
   * `restore` should degrade gracefully (e.g. return an empty result) when
   * unsupported, rather than throwing, so one unsupported mechanism never
   * fails an entire capture/clear/restore pass.
   */
  isSupported?(tabId: number): Promise<boolean>;
}
