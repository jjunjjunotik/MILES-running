/** 테스트 빌드 전용 가짜 @capacitor/app-launcher. 연 주소만 기록한다. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const AppLauncher = {
  async openUrl(options: { url: string }) {
    (window as any).__fakeStore.opened.push(options.url);
    return { completed: true };
  },
};
