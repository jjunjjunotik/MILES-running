# RevenueCat 결제 설정 (App Store · Google Play)

NailSense 의 Pro 는 App Store · Google Play **인앱 구독**으로만 팝니다. 영수증 확인은 RevenueCat 이 하고,
서버는 RevenueCat 에 물어본 결과로만 Pro 를 켭니다(README "유료 구독" 참고).

이 문서는 **처음 한 번 하는 설정**을 순서대로 적었습니다.
RevenueCat 안의 구성(권한 · 상품 · 오퍼링 · 패키지 · 웹훅)은 `npm run revenuecat -- --apply` 가 만들어 줍니다.
사람이 해야 하는 것은 계정 · 스토어 쪽 일과 키 만들기입니다.

> 표시: ✅ 이 저장소/도구가 함 · 🔲 직접 해야 함 · ⚠️ 순서 주의

---

## 0. 먼저 정할 것

- 🔲 **앱 아이디** — 지금은 `com.nailsense.app`. 스토어 · RevenueCat 에 한 번 등록하면 못 바꿉니다.
  바꾸려면 등록 **전에** `npm run set-app-id -- com.새.아이디` 로 한 번에 바꿉니다(아래 출시 문서 참고).
- 🔲 가격. 예: 월 $4.99 · 연 $39.99(연간에 7일 무료 체험). 스토어에서 정하고, 앱은 스토어가 알려 준 가격을 그대로 보여 줍니다.

## 1. 상품 아이디 (이대로 만들면 도구 · 서버와 바로 맞습니다)

| | App Store (자동 갱신 구독) | Google Play (정기 결제 : 기본 요금제) |
|---|---|---|
| 월간 | `nailsense_pro_monthly` (1개월) | `nailsense_pro_monthly` : `monthly` (1개월, 자동 갱신) |
| 연간 | `nailsense_pro_yearly` (1년) | `nailsense_pro_yearly` : `yearly` (1년, 자동 갱신) |

- App Store 의 두 상품은 **같은 구독 그룹**("NailSense Pro")에 넣습니다. 그래야 한 사람이 둘을 동시에 사지 않습니다.
- Google Play 는 기간마다 **정기 결제를 따로** 만들고 각각 기본 요금제를 하나 둡니다. 상품 아이디에 기간이 들어가
  서버가 기간(월간/연간)을 바로 알아봅니다.
- 다른 아이디를 쓰려면 도구 실행 때 `APPSTORE_PRODUCT_MONTHLY` 같은 값으로 바꿀 수 있습니다(scripts/revenuecat.mjs 머리말).

## 2. RevenueCat 가입과 키 두 개

1. 🔲 https://app.revenuecat.com 가입 → 프로젝트 만들기(이름 예: NailSense).
2. 🔲 **Project settings › API keys › + New secret API key** 로 키를 **두 개** 만듭니다.

| 키 | API version · 권한 | 어디에 넣나 | 하는 일 |
|---|---|---|---|
| 서버용 | **V1** | 서버 비밀값 `REVENUECAT_SECRET_KEY` | 서버가 구독 상태를 물어봄, 탈퇴 시 기록 삭제 |
| 설정용 | **V2**, Project configuration **Read & write** | **내 컴퓨터 `.env` 에만** `REVENUECAT_V2_KEY` | `npm run revenuecat` 이 설정을 만듦. 끝나면 지워도 됨 |

3. 🔲 웹훅 인증값을 만듭니다(아무도 모르는 긴 값). 터미널에서:
   ```bash
   openssl rand -hex 32
   ```
   나온 값을 `.env` 의 `REVENUECAT_WEBHOOK_AUTH` 와 서버 비밀값에 **같게** 넣습니다.

## 3. 도구로 RevenueCat 구성 만들기 ✅

```bash
npm run revenuecat                # 먼저 확인만. 아무것도 바꾸지 않고 무엇이 빠졌는지 보여 줌
npm run revenuecat -- --apply     # 빠진 앱 · 권한(pro) · 상품 4개 · 오퍼링(default) · 패키지 · 웹훅을 만듦
```

- 앱이 없으면 App Store 앱과 Play Store 앱을 앱 아이디로 만듭니다. 번들 아이디가 다른 앱이 이미 있으면 손대지 않고 알려 줍니다.
- 끝에 **앱용 공개 키**(`appl_…`, `goog_…`)를 알려 줍니다. `.env` 와 서버 비밀값의 `REVENUECAT_IOS_KEY`,
  `REVENUECAT_ANDROID_KEY` 에 넣습니다(공개 키라 앱에 들어가도 되는 값입니다).
- 몇 번을 돌려도 같은 것을 두 번 만들지 않습니다. 모두 갖춰지면 "RevenueCat 설정이 다 되어 있습니다" 가 나옵니다.
- 웹훅 주소는 `APP_API_BASE`(기본 `https://nailsense.fly.dev`) + `/api/billing/store-webhook` 입니다. 서버를 다른 주소에 두면
  `APP_API_BASE=https://내서버 npm run revenuecat -- --apply`.

## 4. App Store 연결 (iOS)

1. 🔲 App Store Connect › **계약, 세금 및 금융 정보(Agreements, Tax, and Banking)** 에서 **유료 앱 계약**을 활성화
   (은행 계좌 · 세금 양식). 이게 없으면 sandbox 구매도 안 됩니다.
2. 🔲 App Store Connect › 앱 만들기(번들 아이디 = 앱 아이디).
3. 🔲 앱 › 수익화 › **구독** › 구독 그룹 "NailSense Pro" → 위 표의 두 상품, 기간, 가격, (연간) 7일 무료 체험(Introductory Offer),
   영어 · 한국어 이름과 설명, **심사용 스크린샷**(요금제 화면 캡처) 넣기.
   ⚠️ 첫 구독 상품은 **첫 앱 버전과 함께 심사 제출**해야 합니다(버전 페이지의 "앱 내 구입 및 구독" 에서 선택).
4. 🔲 **In-App Purchase Key**: App Store Connect › 사용자 및 액세스(Users and Access) › 통합(Integrations) ›
   In-App Purchase › 키 만들기 → .p8 파일을 내려받기(한 번만 받을 수 있음) → RevenueCat › Apps › App Store 앱 ›
   "In-app purchase key configuration" 에 .p8 과 Issuer ID 를 넣고 저장 → "Valid credentials" 확인. **필수**입니다.
5. 🔲 (권장) RevenueCat App Store 앱 설정에 나오는 **Apple Server Notification URL** 을 App Store Connect › 앱 ›
   앱 정보 › App Store 서버 알림(버전 2)의 운영 · Sandbox 주소에 붙여 넣기. 갱신 · 환불이 빨리 반영됩니다.

## 5. Google Play 연결 (Android)

⚠️ **순서**: Play Console 은 결제 권한(BILLING)이 든 앱 번들을 한 번 올린 뒤에야 정기 결제 상품을 만들게 해 줍니다.
이 앱 번들에는 이미 그 권한이 들어 있습니다. 먼저 내부 테스트 트랙에 `.aab` 를 한 번 올리세요(docs/store-release.md 5).

1. 🔲 Play Console › 설정 › **결제 프로필**(판매자 계정) 만들기.
2. 🔲 앱 › 수익 창출 › 제품 › **정기 결제** → `nailsense_pro_monthly`(기본 요금제 `monthly`, 1개월 자동 갱신, 가격),
   `nailsense_pro_yearly`(기본 요금제 `yearly`, 1년, 가격, 원하면 7일 무료 체험 혜택) → 기본 요금제 **활성화**.
3. 🔲 **서비스 계정**(RevenueCat 이 구매를 확인할 때 씀)
   - Google Cloud: **Google Play Android Developer API**, **Google Play Developer Reporting API**, **Cloud Pub/Sub API** 사용 설정
   - 서비스 계정 만들기, 역할 **Pub/Sub Editor** · **Monitoring Viewer**, JSON 키 내려받기
   - Play Console › 사용자 및 권한 › 서비스 계정 이메일 초대, 권한: 앱 정보 보기 및 대량 보고서 다운로드(읽기 전용),
     재무 데이터 · 주문 · 취소 설문 응답 보기, 주문 및 정기 결제 관리, 스토어 등록정보 관리
   - RevenueCat › Apps › Play Store 앱 › **Service Account Credentials JSON** 에 올리기.
     ⚠️ 구글 쪽에서 유효해지기까지 **최대 36시간** 걸릴 수 있습니다(그동안 "Invalid Play Store credentials").
4. 🔲 (권장) RevenueCat Play Store 앱 설정에서 **실시간 개발자 알림(Pub/Sub 주제)** 을 켜고, 나온 주제 이름을
   Play Console › 수익 창출 설정 › 실시간 개발자 알림에 넣기.

## 6. 서버 비밀값

```bash
fly secrets set REVENUECAT_SECRET_KEY=… REVENUECAT_WEBHOOK_AUTH=… \
  REVENUECAT_IOS_KEY=appl_… REVENUECAT_ANDROID_KEY=goog_…
```

서버가 켜질 때 로그에 `인앱 구독: RevenueCat (iOS · Android)` 가 나오면 켜진 것입니다.
설정용 `REVENUECAT_V2_KEY` 는 서버에 넣지 않습니다.

## 7. 시험 구매 (실제 결제 없음)

- **iOS**: App Store Connect › 사용자 및 액세스 › Sandbox 에서 테스트 계정 만들기 → TestFlight 빌드 설치 →
  요금제 › 구독 → 테스트 계정으로 결제 → Pro 로 바뀌는지 확인. 구독 관리 · 해지도 눌러 보기.
- **Android**: Play Console › 설정 › **라이선스 테스트** 에 테스트할 Google 계정 추가 → 내부 테스트로 설치 →
  "테스트 카드" 로 결제 → Pro 확인.
- RevenueCat › Customers 에 구매가 보이고, Integrations › Webhooks › **Send test event** 가 성공하는지 확인.
- 마지막으로 `npm run revenuecat` 을 다시 돌려 빠진 것이 없는지 확인.

## 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| 앱 요금제 화면에 "요금제를 불러오지 못했어요" | 오퍼링 default 가 현재 오퍼링인지, 상품이 스토어에 만들어져 있고(가격 포함) 승인 · 활성 상태인지, 유료 앱 계약 |
| 결제는 됐는데 Pro 가 안 됨 | 서버 `REVENUECAT_SECRET_KEY`(V1), 권한 이름 `pro` 와 서버 `REVENUECAT_ENTITLEMENT` 일치, 상품이 권한에 붙어 있는지 |
| 안드로이드에서만 실패 | 서비스 계정 권한, 36시간 대기, 정기 결제의 기본 요금제가 활성인지 |
| 갱신 · 해지가 늦게 반영 | 웹훅 주소와 인증값, App Store 서버 알림 · Play 실시간 개발자 알림 |
