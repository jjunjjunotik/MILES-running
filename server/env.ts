import fs from "node:fs";

/**
 * .env 를 process.env 로 읽어들인다.
 *
 * 반드시 다른 서버 모듈보다 먼저 import 되어야 한다. 모듈 최상위에서
 * 키를 읽는 코드가 있으면, 그 시점에 이미 값이 들어와 있어야 하기 때문이다.
 *
 * Node 22 에 내장된 loadEnvFile 을 쓴다. dotenv 의존성이 필요 없고,
 * 이미 설정된 환경변수를 덮어쓰지 않는다(배포 환경의 값이 우선).
 */
const ENV_FILE = process.env.ENV_FILE ?? ".env";

if (fs.existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (err) {
    // 파싱 실패 시에도 키 값이 섞여 나올 수 있으므로 메시지를 그대로 쓰지 않는다.
    console.warn(`[env] ${ENV_FILE} 을 읽지 못했습니다. 형식을 확인하세요.`);
    void err;
  }
}

export const ENV_FILE_PATH = ENV_FILE;
export const ENV_FILE_LOADED = fs.existsSync(ENV_FILE);
