/**
 * .env 의 키로 실제 쓸 수 있는 Gemini 모델을 나열한다.
 *
 *   npm run models
 *
 * 404 "분석 서버에서 오류가 발생했습니다" 가 뜨면 대개 모델 이름 문제다.
 * 쓸 수 있는 모델은 키와 지역에 따라 다르므로, 추측하지 말고 여기서 확인한다.
 * 목록에서 고른 이름을 .env 의 GEMINI_MODEL 에 적으면 된다.
 */
import fs from "node:fs";

/**
 * 여기서는 SDK 대신 REST 를 직접 부른다. SDK 의 models.list() 가
 * supportedActions 를 떼어내고 돌려주는데, 어떤 모델이 이 앱에서 실제로
 * 쓸 수 있는지(generateContent 지원 여부)를 가리려면 그 값이 필요하다.
 * 앱 본체는 그대로 SDK 를 쓴다.
 */

const envFile = process.env.ENV_FILE ?? ".env";
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.error(
    `${envFile} 에서 GEMINI_API_KEY 를 찾지 못했습니다.\n` +
      "package.json 이 있는 폴더에서 실행했는지, 키를 채웠는지 확인하세요.",
  );
  process.exit(1);
}

const baseUrl =
  process.env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com";
const current = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const usable = [];

let payload;
try {
  const response = await fetch(`${baseUrl}/v1beta/models?pageSize=200`, {
    // 키는 헤더로 보낸다. URL 에 실으면 로그와 리퍼러에 남는다.
    headers: { "x-goog-api-key": apiKey },
  });

  if (!response.ok) {
    if ([400, 401, 403].includes(response.status)) {
      console.error(
        "키가 인증되지 않았습니다. GEMINI_API_KEY 값을 다시 확인하세요.\n" +
          "발급: https://aistudio.google.com/apikey",
      );
    } else {
      // 응답 본문에 키가 섞여 올 수 있으므로 상태 코드만 전한다.
      console.error(`모델 목록을 가져오지 못했습니다. (${response.status})`);
    }
    process.exit(1);
  }

  payload = await response.json();
} catch {
  console.error(
    "모델 목록을 가져오지 못했습니다. 네트워크 연결을 확인하세요.",
  );
  process.exit(1);
}

for (const model of payload.models ?? []) {
  // 이름은 "models/gemini-..." 형태로 온다. .env 에는 뒤쪽만 적는다.
  const id = (model.name ?? "").replace(/^models\//, "");
  if (!id) continue;
  // 이 앱은 generateContent 로만 분석한다. 임베딩 전용 모델 등은 제외한다.
  if (!(model.supportedGenerationMethods ?? []).includes("generateContent")) {
    continue;
  }
  usable.push({ id, label: model.displayName ?? "" });
}

if (usable.length === 0) {
  console.error("이 키로 쓸 수 있는 모델이 없습니다. 키 권한을 확인하세요.");
  process.exit(1);
}

console.log(`이 키로 쓸 수 있는 모델 ${usable.length}개:\n`);
for (const { id, label } of usable) {
  const mark = id === current ? " ← 지금 설정된 모델" : "";
  console.log(`  ${id}${label ? `  (${label})` : ""}${mark}`);
}

if (!usable.some((m) => m.id === current)) {
  console.log(
    `\n지금 설정된 "${current}" 는 이 목록에 없습니다. 404 의 원인입니다.` +
      "\n위에서 하나를 골라 .env 에 이렇게 적으세요:" +
      "\n\n  GEMINI_MODEL=<위 목록에서 고른 이름>\n",
  );
} else {
  console.log(`\n"${current}" 는 쓸 수 있는 모델입니다.`);
}
