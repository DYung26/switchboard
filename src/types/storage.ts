import type { STORAGE_AREA } from "@/constants/app";

export type StorageArea = (typeof STORAGE_AREA)[keyof typeof STORAGE_AREA];

export interface StorageChange<T> {
  oldValue: T | undefined;
  newValue: T | undefined;
}

export type StorageChangeListener<T> = (change: StorageChange<T>) => void;

export interface StorageService {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  watch<T>(key: string, listener: StorageChangeListener<T>): () => void;
}
