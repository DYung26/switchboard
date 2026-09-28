export interface NetworkRequest {
  id: string;
  tabId: number;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  status?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  mimeType?: string;
  capturedAt: number;
}

export interface SavedNetworkRequest {
  id: string;
  name: string;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NetworkReplayResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface NetworkReplaySet {
  path: string;
  value: string;
}

export interface NetworkReplayRequest {
  id: string;
  sets?: NetworkReplaySet[];
  /** Explicit raw string replacement escape hatch. Prefer `sets`. */
  replacements?: Record<string, string>;
  target?: "active";
  tabId?: number;
}
