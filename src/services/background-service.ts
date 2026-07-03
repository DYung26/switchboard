export interface BackgroundService {
  readonly name: string;
  init(): void | Promise<void>;
}
