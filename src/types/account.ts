import type { SessionSnapshot } from "./snapshot";

export interface SavedAccount {
  id: string;
  origin: string;
  name: string;
  snapshot: SessionSnapshot;
  position: number;
  createdAt: number;
  updatedAt: number;
  lastUsed: number | undefined;
}
