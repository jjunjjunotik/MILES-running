/**
 * 앱 아이디 바꾸기(scripts/set-app-id.mjs)를 프로젝트 파일 사본에서 시험한다. 진짜 파일은 건드리지 않는다.
 *
 *   npm run check:set-app-id
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILES = [
  "capacitor.config.ts",
  "android/app/build.gradle",
  "android/app/src/main/res/values/strings.xml",
  "ios/App/App.xcodeproj/project.pbxproj",
  "codemagic.yaml",
];
const CURRENT = /appId:\s*"([^"]+)"/.exec(fs.readFileSync("capacitor.config.ts", "utf8"))[1];
const ACTIVITY = (id) => path.join("android/app/src/main/java", ...id.split("."), "MainActivity.java");

const problems = [];
const check = (condition, label) => {
  if (condition) console.log(`  ok  ${label}`);
  else {
    problems.push(label);
    console.log(`실패  ${label}`);
  }
};

function copyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nailsense-appid-"));
  for (const file of [...FILES, ACTIVITY(CURRENT)]) {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.copyFileSync(file, path.join(dir, file));
  }
  return dir;
}
const run = (dir, id) => {
  const result = spawnSync("node", [path.resolve("scripts/set-app-id.mjs"), id], { cwd: dir, encoding: "utf8" });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
};
const read = (dir, file) => fs.readFileSync(path.join(dir, file), "utf8");
const snapshot = (dir) => FILES.map((file) => read(dir, file)).join("\n---\n");

const dirs = [];
try {
  console.log("올바른 새 아이디");
  const dir = copyProject();
  dirs.push(dir);
  const NEXT = "kr.example.nailcheck";
  const result = run(dir, NEXT);
  check(result.code === 0, `바꾸기 성공 (${result.code})`);
  check(read(dir, "capacitor.config.ts").includes(`appId: "${NEXT}"`), "capacitor.config.ts");
  const gradle = read(dir, "android/app/build.gradle");
  check(gradle.includes(`namespace = "${NEXT}"`) && gradle.includes(`applicationId "${NEXT}"`), "build.gradle namespace · applicationId");
  check(fs.existsSync(path.join(dir, ACTIVITY(NEXT))) && !fs.existsSync(path.join(dir, ACTIVITY(CURRENT))), "MainActivity 를 새 패키지 폴더로 옮김");
  check(read(dir, ACTIVITY(NEXT)).startsWith(`package ${NEXT};`), "MainActivity 의 package 줄");
  check(!fs.existsSync(path.join(dir, "android/app/src/main/java", ...CURRENT.split(".").slice(0, 1))), "비게 된 옛 폴더는 지움");
  const strings = read(dir, "android/app/src/main/res/values/strings.xml");
  check(strings.includes(`<string name="package_name">${NEXT}</string>`) && strings.includes(`<string name="custom_url_scheme">${NEXT}</string>`), "strings.xml");
  check((read(dir, "ios/App/App.xcodeproj/project.pbxproj").match(new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = ${NEXT.replace(/\./g, "\\.")};`, "g")) ?? []).length === 2, "Xcode 번들 아이디 2곳(Debug · Release)");
  const codemagic = read(dir, "codemagic.yaml");
  check(codemagic.includes(`BUNDLE_ID: ${NEXT}`) && codemagic.includes(`PACKAGE_NAME: ${NEXT}`) && codemagic.includes(`bundle_identifier: ${NEXT}`), "codemagic.yaml");
  check(!snapshot(dir).includes(CURRENT), "옛 아이디가 남지 않음");
  check(run(dir, NEXT).code === 0 && /이미/.test(run(dir, NEXT).out), "같은 아이디로 다시 하면 아무것도 안 함");

  console.log("틀린 아이디는 거절(아무것도 안 바꿈)");
  const dir2 = copyProject();
  dirs.push(dir2);
  const before = snapshot(dir2);
  for (const bad of ["", "nailsense", "Com.Example.App", "com.example.new", "com.example-app.x", "com.1app.x", "com..x"]) {
    const r = run(dir2, bad);
    check(r.code === 2, `"${bad}" 거절`);
  }
  check(snapshot(dir2) === before && fs.existsSync(path.join(dir2, ACTIVITY(CURRENT))), "거절하면 파일이 그대로");

  console.log("예상과 다른 파일이 있으면 하나도 안 바꿈");
  const dir3 = copyProject();
  dirs.push(dir3);
  const pbx = path.join(dir3, "ios/App/App.xcodeproj/project.pbxproj");
  fs.writeFileSync(pbx, fs.readFileSync(pbx, "utf8").replace(`PRODUCT_BUNDLE_IDENTIFIER = ${CURRENT};`, "PRODUCT_BUNDLE_IDENTIFIER = com.someone.edited;"));
  const before3 = snapshot(dir3);
  const r3 = run(dir3, "kr.example.nailcheck");
  check(r3.code === 1 && /아무것도 바꾸지 않았습니다/.test(r3.out), "멈추고 이유를 알림");
  check(snapshot(dir3) === before3 && fs.existsSync(path.join(dir3, ACTIVITY(CURRENT))), "다른 파일도 그대로(반쯤 바뀐 상태 없음)");
} catch (err) {
  problems.push(`예외: ${err.message.split("\n")[0]}`);
} finally {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`\n실패 ${problems.length}건:`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("\n앱 아이디 바꾸기 점검 통과.");
