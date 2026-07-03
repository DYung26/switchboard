import { useCallback, useEffect, useState } from "react";
import { storageService } from "@/storage";

export function useStorageValue<T>(
  key: string,
): readonly [T | undefined, (value: T) => Promise<void>] {
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    let isMounted = true;

    void storageService.get<T>(key).then((stored) => {
      if (isMounted) {
        setValue(stored);
      }
    });

    const unwatch = storageService.watch<T>(key, (change) => {
      if (isMounted) {
        setValue(change.newValue);
      }
    });

    return () => {
      isMounted = false;
      unwatch();
    };
  }, [key]);

  const update = useCallback(
    async (next: T) => {
      await storageService.set(key, next);
    },
    [key],
  );

  return [value, update] as const;
}
