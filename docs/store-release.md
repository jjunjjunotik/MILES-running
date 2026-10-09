# 앱스토어 · 구글 플레이 출시 안내

이 저장소에서 준비된 것과, 사람이 직접 해야 하는 것을 순서대로 적었습니다.
상태 표시: ✅ 저장소에 준비됨 · 🔲 직접 해야 함 · ⚠️ 확인 필요(위험)

---

## 0. 먼저 알아 둘 위험 (개인사업자로 낼 때)

⚠️ **Apple — 건강 앱은 개인이 아니라 "법인(조직)" 계정으로 제출하라고 정해 두었습니다.**
App Store 심사 지침 5.1.1(ix)은 의료·건강처럼 규제가 많은 분야의 앱을 개인 개발자가 아닌
법인이 제출하도록 요구합니다. Apple 은 개인사업자를 "개인(Individual)" 계정으로 취급하므로,
개인사업자 명의로 내면 이 조항으로 거절될 수 있습니다. NailSense 는 진단하지 않는 참고용 앱이지만
"건강" 성격이 있어 심사자 판단에 따라 걸릴 수 있습니다. 거절되면 법인 계정으로 옮겨 다시 내야 합니다.

⚠️ **Google — 건강 앱은 "조직(Organization)" 개발자 계정이 필요합니다.**
Google Play 는 건강 앱을 조직 계정(D-U-N-S 번호 필요)으로만 배포하게 했습니다.
한국 개인사업자도 사업자등록번호로 D-U-N-S 번호를 받을 수 있는 경우가 있으니
(한국 D&B 무료 신청) 발급 가능 여부를 먼저 확인하세요. 개인 계정으로 내면 출시 전
"12명 · 14일 비공개 테스트"도 거쳐야 하고, 건강 앱으로 분류되면 반려될 수 있습니다.

⚠️ **Apple 1.4.1 — 의료 관련 앱은 더 엄격하게 봅니다.** 정확도를 입증할 수 없는 건강 판단을
내놓는 것처럼 보이면 거절될 수 있습니다. 앱은 "보이는 모습을 설명"만 하고 진단하지 않으며,
매 결과에 진료 안내와 비진단 문구를 넣었지만, 심사 메모(아래 6)에 이 점을 분명히 적어야 합니다.

출처:
[App Store 심사 지침](https://developer.apple.com/app-store/review/guidelines/) ·
[Google Play 건강 앱 정책](https://support.google.com/googleplay/android-developer/answer/13634885) ·
[Google Play 조직 계정 요건](https://support.google.com/googleplay/android-developer/answer/14151465) ·
[2026 Google Play 건강 앱 요건 정리](https://myappmonitor.com/blog/google-play-health-apps-update-2026-requirements)

---

## 1. 계정과 이름 정하기

- 🔲 Apple Developer Program 가입(연 US$99) — 가능하면 **조직(법인)** 으로. 법인이 없으면 위 위험을 감수.
- 🔲 Google Play Console 가입(1회 US$25) — **조직 계정** + D-U-N-S 번호.
- 🔲 **앱 아이디 확정** (지금은 임시 `com.nailsense.app`). 스토어 · RevenueCat 에 한 번 등록하면 못 바꿉니다.
  ✅ 바꿀 때는 `npm run set-app-id -- com.새.아이디` 한 번이면 됩니다(설정 · 안드로이드 패키지 · Xcode · codemagic 전부).
- 🔲 `shared/legal.ts` 의 `OPERATOR` 빈칸(상호, 주소, 연락 이메일, 개인정보 보호책임자 등) 채우기,
  변호사 검토 후 `LEGAL_STATUS` 를 `"final"` 로.
- 🔲 AI 분석 업체(Gemini/Anthropic)의 데이터 처리 조건이 "학습에 쓰지 않음"인지 확인
  (스토어 설명과 개인정보처리방침에 그렇게 적었습니다).

## 2. 서버

- ✅ Fly.io 배포 설정(`fly.toml`, `Dockerfile`)
- ✅ 공개 페이지: `/privacy`, `/terms`, `/delete-account`, `/support` (영어 · 한국어, `?lang=ko`)
- 🔲 `fly deploy` 후 위 네 주소가 열리는지 확인. 스토어 등록 화면에 이 주소들을 넣습니다.

## 3. 로그인

- ✅ 앱은 토큰 방식 로그인(키체인 · 키스토어 보관), 서버는 앱 출처만 CORS 허락
- ✅ 아이폰: 구글 + 애플 로그인(네이티브). 안드로이드: 구글 로그인(애플 로그인 의무 없음)
- ✅ iOS `App.entitlements` 에 Sign in with Apple
- 🔲 Google Cloud Console › 사용자 인증 정보:
  - 웹 클라이언트 아이디 → 서버 `GOOGLE_CLIENT_ID` (이미 웹용으로 있으면 그대로)
  - iOS 클라이언트 아이디(번들 아이디로 생성) → 서버 `GOOGLE_IOS_CLIENT_ID`,
    그리고 iOS `Info.plist` 에 URL 스킴(역순 클라이언트 아이디, `com.googleusercontent.apps.…`) 추가
  - Android 클라이언트 아이디(패키지 이름 + **서명 키의 SHA-1**) 생성. Play 앱 서명을 쓰면
    Play Console › 앱 무결성에 나오는 "앱 서명 키 인증서"의 SHA-1 도 함께 등록
- 🔲 Apple Developer › Identifiers › 앱 아이디에 Sign in with Apple 켜기 → 서버 `APPLE_BUNDLE_ID=<번들 아이디>`

## 4. 인앱 구독 (RevenueCat)

- ✅ 앱 결제 화면, 구매 복원, 스토어 구독 관리, 서버 확인, 웹훅 (README "유료 구독" 참고). 웹 결제(Paddle)는 없앰
- ✅ RevenueCat 안의 구성(앱 · 권한 pro · 상품 4개 · 오퍼링 · 패키지 · 웹훅)은 `npm run revenuecat -- --apply` 가 만듦
- 🔲 순서대로: **[docs/revenuecat-setup.md](revenuecat-setup.md)** — 키 두 개, 스토어 상품과 가격(App Store 구독 그룹,
  Play 정기 결제 · 기본 요금제), 유료 앱 계약 · 결제 프로필, 스토어 자격증명 연결, 서버 비밀값, 시험 구매

## 5. 빌드 (Mac 없이)

- ✅ `codemagic.yaml`: iOS → TestFlight, Android → Play 내부 테스트
- ✅ 아이콘 · 스플래시(`assets/icon.svg` → `npm run make:icons`), iOS 아이콘은 알파 채널 없음
- ✅ 안드로이드: 카메라 권한 없음(시스템 카메라 사용), 백업 꺼짐, 세로 고정. iOS: 아이폰 전용, 세로 고정
- 🔲 Codemagic 가입, 저장소 연결, App Store Connect API 키 · 안드로이드 업로드 키 · Play 서비스 계정 등록
  (`codemagic.yaml` 맨 위 안내)
- 🔲 **안드로이드 첫 업로드는 Play Console 에서 직접** (새 앱은 API 로 첫 번들을 올릴 수 없음).
  Codemagic 산출물의 `.aab` 를 받아 내부 테스트 트랙에 올린 뒤부터 자동 업로드가 됩니다.
- 🔲 실제 기기에서 확인: 촬영 → 분석 → 결과, 로그인 3종, 구독(스토어 테스트 계정), 복원, 계정 삭제

## 6. 심사 제출물

### App Store Connect

- 개인정보처리방침 URL: `https://<서버>/privacy` · 지원 URL: `https://<서버>/support`
- 이용약관: 앱 설명 끝에 `https://<서버>/terms` 링크(자동 갱신 구독 앱 필수). 또는 Apple 표준 EULA 사용
- 연령 등급: 의료/치료 정보 "드물게/경미" 정도로 답하고, 앱 대상은 만 18세 이상(약관과 일치)
- **App Privacy(개인정보 라벨)** — 아래 표
- **심사 메모(App Review Information › Notes)** 예시:

  > NailSense describes the visible appearance of a nail in a user's photo (color, surface, shape) in plain
  > language and gives general care tips. It does not diagnose, screen for, or rule out any condition, and every
  > result includes a non-diagnostic notice and guidance on when to see a doctor. The app does not provide
  > treatment, dosage, or prescriptions. Photos are processed by our server and an AI provider to create the
  > description and are not stored on the server.
  > Demo account: <이메일> / <비밀번호> (Pro is not required to review; 3 free scans per month).
  > Subscriptions: Profile › Plan. Restore purchases is on the same screen. Account deletion: Profile › Delete account.

- 🔲 심사용 데모 계정을 만들어 위 메모에 적기(이메일 로그인 계정)

### App Privacy 라벨 (App Store)

| 데이터 | 수집 | 사용자와 연결 | 추적 | 목적 |
|---|---|---|---|---|
| 건강 및 피트니스 › 건강 (손톱 사진·설명·메모) | 예 | 예(로그인 시 결과 저장) | 아니요 | 앱 기능 |
| 사진 또는 비디오 | 예(분석 때 전송, 서버 미저장) | 아니요 | 아니요 | 앱 기능 |
| 연락처 정보 › 이메일 주소 | 예 | 예 | 아니요 | 앱 기능(계정) |
| 연락처 정보 › 이름 | 예(선택) | 예 | 아니요 | 앱 기능 |
| 식별자 › 사용자 ID | 예 | 예 | 아니요 | 앱 기능 |
| 구매 항목 › 구입 내역 | 예 | 예 | 아니요 | 앱 기능 |
| 식별자 › 기기 ID(설치마다 만든 무작위 값) | 예 | 아니요 | 아니요 | 앱 기능(무료 한도) |

추적(ATT): 하지 않음. 광고 · 분석 SDK 없음.

### Google Play 데이터 보안(Data safety)

- 데이터 수집: 예 / 제3자 공유: 아니요(처리 위탁은 "공유"가 아님) / 전송 중 암호화: 예 / 삭제 요청: 예(앱 안 + `/delete-account`)
- 수집 항목
  - 건강 및 피트니스 › 건강 정보: 앱 기능, 선택(분석할 때만)
  - 사진 및 동영상 › 사진: 앱 기능, 일시적 처리(ephemeral) — 서버에 저장하지 않음
  - 개인 정보 › 이메일 주소, 이름(선택), 사용자 ID: 계정 관리
  - 금융 정보 › 구매 내역: 앱 기능
  - 기기 또는 기타 ID: 앱 기능(무료 한도), 부정 이용 방지
- **건강 앱 선언(Health apps declaration)**: "건강 및 피트니스 › 일반 건강 정보/기록" 성격. 의료기기 아님, 진단 안 함.
- 계정 삭제 URL: `https://<서버>/delete-account`

## 7. 출시 뒤

- 🔲 RevenueCat 웹훅이 서버에 닿는지(대시보드에서 테스트 이벤트) 확인
- 🔲 `fly logs` 로 오류 확인. 서버는 사진 · 요청 본문을 로그에 남기지 않습니다.
- 🔲 약관 · 가격을 바꾸면 앱 안 문구, `/terms`, 스토어 설명을 함께 고치기
