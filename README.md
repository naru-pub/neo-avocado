# 네오 아보카도

[AvocadoEdition](https://github.com/tateck-develop/AvocadoEdition)(그누보드 5 기반
자캐 커뮤니티)을 나루 SDK 1.1.0으로 옮긴 사이트입니다. 원본의 어떤 기능을 어떻게
옮겼는지, 무엇을 옮기지 않았는지는 [docs/porting.md](docs/porting.md)에 있습니다.

## 처음 설치하기

**필요한 것**: 사이트 데이터베이스는 나루 서포터 플랜에 포함되어 있습니다.
회원으로 로그인하는 사람도 서포터 플랜이 있어야 하며, 예외가 필요한 커뮤니티는
나루 운영자에게 문의해 주세요.

1. **사이트에 설치합니다.** 둘 중 하나를 고르세요.
   - 나루 게시판의 네오 아보카도 템플릿에서 **적용하기**를 누르고, 적용할 폴더를
     **사이트 맨 위(루트)**로 고릅니다. 서버 함수가 들어 있는 `_naru/` 폴더는
     사이트 맨 위에 있어야 동작하므로, 하위 폴더에 적용하면 회원 기능이 켜지지
     않습니다.
   - 또는 이 저장소를 내 GitHub로 가져가 나루의 GitHub 배포를 사이트 맨 위에
     연결합니다. 이후 푸시할 때마다 사이트가 갱신됩니다.
2. **컬렉션은 파일과 함께 준비됩니다.** `_naru/collections.json`이 이 사이트에
   필요한 컬렉션과 권한을 선언하고, 나루는 파일이 올라오는 순간 없는 컬렉션을
   만듭니다: 로그·댓글은 `community-board` 규칙과 함께 회원(공개 게시판은
   손님도)이 읽고, 캐릭터는 `characters` 규칙이 볼 수 있는 항목만 보여 주며,
   프로필은 닉네임 중복 금지, 나머지는 관리자만 읽고 씁니다. 이미 있는
   컬렉션의 설정을 바꿔야 하면 나루의 데이터베이스 화면에 표시되고, 확인한
   뒤 적용하기를 누르면 바뀝니다. 그다음 `admin.html`에서 운영자 로그인을
   누릅니다.
3. **가입 방식을 정합니다.** 나루의 데이터베이스 → 사이트 회원에서 누구나 가입,
   운영자 승인 후 이용, 신규 가입 중단 중 하나를 고르고, 필요하면 이메일을
   인증한 계정만 받도록 합니다.
4. **운영 화면에서 커뮤니티를 꾸밉니다.** 게시판(예: 자유, 공지)과 등급,
   캐릭터 추가 항목, 디자인과 메뉴, 안내 페이지를 만듭니다. 게시판이 하나도
   없으면 회원에게는 기본 로그 게시판이 보이고, 손님에게는 아무것도 보이지
   않습니다.

개발할 때는:

- 검사: `npm test`, `npm run lint`
- 로컬 나루(naru-dev)에서 실제 Chromium으로 전체 흐름:
  `NARU_REPO_PATH=… PLAYWRIGHT_MODULE=… npm run test:e2e`
- 직접 써 보기: 나루 저장소의 `control-plane/`에서
  `pnpm naru-dev ~/Git/neo-avocado --site neo-avocado` 후 http://localhost:4000

## 손님과 공개 게시판

그누보드처럼 등급 1은 로그인하지 않은 손님입니다. 게시판의 목록·본문 등급을
1로 두면 누구나 읽고, 글쓰기·댓글 등급을 1로 두면 손님이 이름과 비밀번호로
씁니다. 손님 글은 그 비밀번호로만 고치고 지웁니다. 손님은 비밀글, 캐릭터,
탐색·아이템, 호출, 파일 올리기를 쓸 수 없고 그림은 HTTPS 주소로 넣습니다.
비밀번호는 나루가 글의 쓰기 비밀(secret)로 PBKDF2 해시만 보관하며, 아무도 읽을 수
없습니다. 읽기 등급이 1인 안내 페이지도 공개됩니다.

## 게시판

로그마다 게시판별 번호(No.)가 붙고, 본문의 `@번호`는 그 로그를, `#태그`는
같은 태그의 로그를 엽니다. 모더레이터는 로그를 공지로 올리거나 다른
게시판으로 옮깁니다. 게시판 설정의 **HTML 본문 허용**을 켜면 최대 12,000자의
HTML 글을 쓰며, 스크립트·폼·스타일은 표시하지 않습니다. 댓글 행동에는 탐색,
아이템 사용과 함께 **조합**(재료 1~3개, 레시피와 맞으면 제작, 틀리면 재료만
소모)이 있습니다.

## 메뉴·디자인·메인 슬라이드

운영 화면의 **디자인**에서 사이트 이름, 로고, 배경, 글꼴과 색을, **메뉴**에서
상단 메뉴(2단계까지)를, **메인 슬라이드·인트로**에서 기간이 있는 배너와 첫
방문 인트로를 정합니다. 메뉴 연결은 `board:게시판ID`, `content:내용페이지ID`,
`tab:characters`(또는 shop·quests·messages·calls), `https://` 주소입니다.

## 롤플레이 (캐릭터로 쓰기·탐색·호출)

로그와 댓글을 내 캐릭터로 쓰면 이름, 표시 중인 타이틀, 입은 의상이 함께
남습니다. 주사위는 서버가 굴리고 수정해도 바뀌지 않습니다. 댓글에서
탐색(승인된 캐릭터, 한국 시간 기준 하루 횟수)과 아이템 사용을 할 수 있고,
`[[닉네임]]`으로 회원을 호출합니다. 호출과 내 글의 댓글은 **알림** 탭에
쌓입니다. 캐릭터에는 운영자가 정한 추가 프로필 항목과 수정 중 → 신청 → 승인
상태가 있고, 운영 화면의 **캐릭터 신청 심사**에서 승인합니다.

**기본 설정**의 하루 탐색 횟수(0이면 탐색 끔), **탐색 표**, 게시판의 **댓글
행동 허용**을 설정합니다.

## 안내 페이지

**내용 페이지**에서 제목, 본문 형식,
기본·모바일 본문, 상단·하단 이미지, 공개 여부와 읽기 등급을 설정합니다.
회원 화면 **안내**에서 선택해 읽습니다. 모바일 본문이 비어 있으면 기본 본문을
표시합니다. 본문은 각각 최대 12,000자입니다.

HTML은 [DOMPurify](https://github.com/cure53/DOMPurify)로 정리하여 표시합니다.
스크립트·폼·전체 페이지에 영향을 주는 스타일/ID/이름은 표시하지 않습니다.
원본의 PHP include와 skin 파일은 내용이나 정적 테마 구성요소로 옮겨야 합니다.
`npm run vendor:content`로 잠긴 의존성에서 배포용 자산을 갱신하고,
`npm run vendor:check`로 자산이 의존성과 일치하는지 검사합니다.

## 코드 둘러보기

기능 하나가 화면 파일 하나와 서버 함수 파일로 나뉘어 있습니다. 화면 쪽은 브라우저에서
그대로 도는 JavaScript 모듈이고, 서버 함수는 나루가 사이트 소유자 권한으로 실행합니다.
돈·재고·주사위처럼 회원이 마음대로 정하면 안 되는 값은 서버 함수만 바꿉니다.

| 기능 | 화면 | 서버 함수 |
| --- | --- | --- |
| 로그인·가입·닉네임 | `app.js` | `_naru/functions/community/membership.js` |
| 게시판·로그·댓글 | `app/logs.js`, `app/posts.js` | `_naru/functions/community/data.js`, `boards.js` |
| 캐릭터 | `app/characters.js` | `_naru/functions/characters/` |
| 상점·인벤토리·제작 | `app/shop.js` | `_naru/functions/economy/` |
| 쪽지 | `app/messages.js` | `_naru/functions/community/messages.js` |
| 알림(호출) | `app/calls.js` | `_naru/functions/community/calls.js` |
| 퀘스트·안내 페이지 | `app/content.js` | `_naru/functions/content/` |
| 디자인·메뉴·배너 | `app/site.js` | `_naru/functions/content/site.js` |
| 새 글·알림 실시간 수신 | `app/live.js` | |
| 운영 화면 | `admin.html`, `admin.js`, `admin-model.js` | `_naru/functions/characters/review.js` |

`app/core.js`는 모든 화면이 함께 쓰는 것(컬렉션 이름, 상태, 오류 표시, 편집 창)입니다.

화면은 서버 함수를 `"파일 경로:함수 이름"`으로 부릅니다.

```js
// app/shop.js: 출석 보상 버튼
$("daily").onclick = () =>
  spend(
    "economy/shop:daily",
    null,
    (result) => `출석 보상을 받았습니다. 잔액 ${result.balance} 아보.`,
  );

function spend(reference, args, success) {
  return run(async () => {
    const result = await state.member.call(reference, args);
    say(success(result));
    await loadShop();
  });
}
```

```js
// _naru/functions/economy/shop.js
export async function daily(ctx) {
  const current = await wallet(ctx);
  const today = kstDay(ctx.now);
  if (current.lastDaily === today)
    ctx.fail("CONFLICT", "오늘은 이미 받았습니다.", { reason: "already" });
  const balance = await pay(ctx, current, -DAILY_REWARD, { lastDaily: today });
  await record(ctx, "daily", { delta: DAILY_REWARD, balance });
  return { balance };
}
```

`ctx.fail`은 호출을 멈추고 그때까지의 쓰기를 모두 되돌립니다. `call`은 그 메시지로
오류를 던지고, `run`이 그 메시지를 화면에 그대로 보여 줍니다. 공통 코드는 `_naru/modules/`에 있고 서버 함수가 정적 import합니다.
번들 생성은 필요하지 않습니다. 자세한 구조는 [_naru/README.md](_naru/README.md)를
참고하세요.
