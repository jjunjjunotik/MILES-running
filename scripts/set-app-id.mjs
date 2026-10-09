/**
 * 앱 아이디(iOS 번들 아이디 · 안드로이드 패키지 이름)를 한 번에 바꾼다.
 *
 *   npm run set-app-id -- com.example.nailsense
 *
 * 스토어와 RevenueCat 에 한 번 등록한 아이디는 바꿀 수 없다. 등록하기 전에 정해서 바꾼다.
 * 바꾸는 곳: capacitor.config.ts, 안드로이드(build.gradle, MainActivity 패키지와 폴더, strings.xml),
 * iOS(Xcode 프로젝트의 번들 아이디), codemagic.yaml.
 * 끝나면 npm run cap:sync 로 네이티브 프로젝트에 반영하고, 서버의 APPLE_BUNDLE_ID 도 같은 값으로 바꾼다.
 */
import fs from "node:fs";
import path from "node:path";

// 안드로이드 패키지 이름 규칙이 iOS 번들 아이디보다 엄격하므로 그쪽에 맞춘다.
// 소문자로 시작하는 마디 2개 이상, 마디마다 소문자 · 숫자 · 밑줄만, 자바 예약어는 안 됨.
const JAVA_KEYWORDS = new Set(
  "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield".split(" "),
);

function invalidReason(id) {
  if (!id) return "새 앱 아이디를 적어 주세요. 예: npm run set-app-id -- com.example.nailsense";
  if (id.length > 150) return "너무 깁니다.";
  const parts = id.split(".");
  if (parts.length < 2) return "점(.)으로 나뉜 마디가 2개 이상이어야 합니다. 예: com.example.nailsense";
  for (const part of parts) {
    if (!/^[a-z][a-z0-9_]*$/.test(part)) return `"${part}": 마디는 영어 소문자로 시작하고 소문자·숫자·밑줄(_)만 쓸 수 있습니다.`;
    if (JAVA_KEYWORDS.has(part)) return `"${part}" 는 안드로이드(자바) 예약어라 쓸 수 없습니다.`;
  }
  return null;
}

const next = (process.argv[2] ?? "").trim();
const reason = invalidReason(next);
if (reason) {
  console.error(reason);
  process.exit(2);
}

const CONFIG = "capacitor.config.ts";
const current = /appId:\s*"([^"]+)"/.exec(fs.readFileSync(CONFIG, "utf8"))?.[1];
if (!current) {
  console.error(`${CONFIG} 에서 지금 앱 아이디를 찾지 못했습니다.`);
  process.exit(2);
}
if (current === next) {
  console.log(`이미 ${next} 입니다.`);
  process.exit(0);
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const old = escape(current);
const javaDir = (id) => path.join("android/app/src/main/java", ...id.split("."));
const oldActivity = path.join(javaDir(current), "MainActivity.java");
const newActivity = path.join(javaDir(next), "MainActivity.java");

/** 바꿀 자리. [파일, [[찾을 모양, 바꿀 값, 있어야 할 개수], ...]] */
const plan = [
  [CONFIG, [[new RegExp(`appId: "${old}"`, "g"), `appId: "${next}"`, 1]]],
  [
    "android/app/build.gradle",
    [
      [new RegExp(`namespace = "${old}"`, "g"), `namespace = "${next}"`, 1],
      [new RegExp(`applicationId "${old}"`, "g"), `applicationId "${next}"`, 1],
    ],
  ],
  [oldActivity, [[new RegExp(`^package ${old};`, "gm"), `package ${next};`, 1]]],
  [
    "android/app/src/main/res/values/strings.xml",
    [
      [new RegExp(`<string name="package_name">${old}</string>`, "g"), `<string name="package_name">${next}</string>`, 1],
      [new RegExp(`<string name="custom_url_scheme">${old}</string>`, "g"), `<string name="custom_url_scheme">${next}</string>`, 1],
    ],
  ],
  ["ios/App/App.xcodeproj/project.pbxproj", [[new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = ${old};`, "g"), `PRODUCT_BUNDLE_IDENTIFIER = ${next};`, 2]]],
  [
    "codemagic.yaml",
    [
      [new RegExp(`BUNDLE_ID: ${old}$`, "gm"), `BUNDLE_ID: ${next}`, 1],
      [new RegExp(`PACKAGE_NAME: ${old}$`, "gm"), `PACKAGE_NAME: ${next}`, 1],
      [new RegExp(`bundle_identifier: ${old}$`, "gm"), `bundle_identifier: ${next}`, 1],
      [new RegExp(`앱 아이디\\(${old}\\)`, "g"), `앱 아이디(${next})`, 1],
    ],
  ],
];

// 1) 모든 파일을 먼저 확인하고 새 내용을 만든다. 하나라도 예상과 다르면 아무것도 바꾸지 않고 멈춘다.
const outputs = [];
for (const [file, replacements] of plan) {
  if (!fs.existsSync(file)) {
    console.error(`${file} 이 없습니다. 이 저장소의 맨 위 폴더에서 실행하세요. (아무것도 바꾸지 않았습니다)`);
    process.exit(2);
  }
  let text = fs.readFileSync(file, "utf8");
  for (const [pattern, replacement, expected] of replacements) {
    const count = (text.match(pattern) ?? []).length;
    if (count !== expected) {
      console.error(`${file}: 바꿀 자리를 ${expected}곳 찾아야 하는데 ${count}곳입니다. 직접 확인해 주세요. (아무것도 바꾸지 않았습니다)`);
      process.exit(1);
    }
    text = text.replace(pattern, replacement);
  }
  outputs.push([file, text]);
}
if (fs.existsSync(newActivity)) {
  console.error(`${newActivity} 이 이미 있습니다. (아무것도 바꾸지 않았습니다)`);
  process.exit(1);
}

// 2) 확인이 끝나면 한꺼번에 쓴다.
const changed = [];
for (const [file, text] of outputs) {
  fs.writeFileSync(file, text);
  changed.push(file);
}

// MainActivity 를 새 패키지 폴더로 옮기고, 비게 된 옛 폴더를 지운다.
fs.mkdirSync(path.dirname(newActivity), { recursive: true });
fs.renameSync(oldActivity, newActivity);
let dir = path.dirname(oldActivity);
const root = path.resolve("android/app/src/main/java");
while (path.resolve(dir) !== root && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
  fs.rmdirSync(dir);
  dir = path.dirname(dir);
}
changed.push(`${oldActivity} → ${newActivity}`);

console.log(`앱 아이디를 ${current} → ${next} 로 바꿨습니다.`);
for (const file of changed) console.log(`  - ${file}`);
console.log(
  "\n다음 할 일:\n" +
    "  1. npm run cap:sync            (네이티브 프로젝트에 반영)\n" +
    `  2. 서버의 APPLE_BUNDLE_ID 를 ${next} 로 (애플 로그인)\n` +
    "  3. Google 로그인용 iOS · Android 클라이언트 아이디를 새 아이디로 다시 만들기\n" +
    "  4. npm run revenuecat         (RevenueCat 앱의 번들 아이디 · 패키지 이름 확인)",
);
