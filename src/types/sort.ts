export const SORT_ORDER = {
  CUSTOM: "custom",
  CREATED: "created",
  USED: "used",
} as const;

export type SortOrder = (typeof SORT_ORDER)[keyof typeof SORT_ORDER];
