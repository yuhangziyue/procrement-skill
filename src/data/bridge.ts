/** 桌面端注入的唯一通道（见 electron/preload.cjs）。Web 端为 undefined，据此切换存储后端。 */
export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  call<T = unknown>(name: string, ...args: unknown[]): Promise<T>;
  dbPath(): Promise<string>;
  revealDb(): Promise<void>;
  saveFile(name: string, data: Uint8Array): Promise<string | null>;
}
declare global {
  interface Window { xiaocai?: DesktopBridge }
}
export const bridge = (): DesktopBridge | undefined => (typeof window === "undefined" ? undefined : window.xiaocai);
export const isDesktop = (): boolean => !!bridge()?.isDesktop;
/** 只在桌面端可用的调用；Web 端调用者应先用 isDesktop() 判断并给降级提示 */
export function desktop(): DesktopBridge {
  const b = bridge();
  if (!b) throw new Error("这个功能只在桌面版可用（网页版没有本地数据库）");
  return b;
}
