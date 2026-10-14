# 네오 아보카도

[AvocadoEdition](https://github.com/tateck-develop/AvocadoEdition)(그누보드 5 기반
자캐 커뮤니티)을 나루 SDK 1.1.0으로 옮긴 사이트입니다. 기능별 이식 현황과
근거, 배포 순서는 [docs/port-status.md](docs/port-status.md)에 있습니다.

- 검사: `npm test`, `npm run lint`
- 실제 나루 실행기(QuickJS + SQLite): `NARU_REPO_PATH=… npm run test:runtime`
- 실제 SDK와 Chrome: `NARU_SDK_PATH=… PLAYWRIGHT_MODULE=… npm run test:browser`

## 손님과 공개 게시판

그누보드처럼 등급 1은 로그인하지 않은 손님입니다. 게시판의 목록·본문 등급을
1로 두면 누구나 읽고, 글쓰기·댓글 등급을 1로 두면 손님이 이름과 비밀번호로
씁니다. 손님 글은 그 비밀번호로만 고치고 지웁니다. 손님은 비밀글, 캐릭터,
탐색·아이템, 호출, 파일 올리기를 쓸 수 없고 그림은 HTTPS 주소로 넣습니다.
비밀번호는 PBKDF2로 저장하며 글과 다른 `neo_avocado_guest_keys` 컬렉션에
둡니다. 읽기 등급이 1인 안내 페이지도 공개됩니다.

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
`neo_avocado_design`, `neo_avocado_menus`, `neo_avocado_banners`,
`neo_avocado_counters`, `neo_avocado_guest_keys` 컬렉션을 읽기·쓰기 모두
**관리자만**으로 만든 뒤 운영자로 다시 로그인하세요.

## 기존 AvocadoEdition 자료 가져오기

1. 기존 DB를 `mysqldump`로 내보냅니다.
2. 회원 번호 대응표 `members.json`을 만듭니다: `{ "옛 mb_id": "나루 회원
번호" }`. 나루 회원 번호는 회원이 이 사이트에 로그인하면 가입 대기 화면에
   보입니다. 대응표에 없는 회원의 글은 옛 닉네임으로 남고 주인이 없습니다.
3. 옛 `data/` 폴더를 HTTPS로 올려 둔 주소를 `--media-base`로 줍니다.
4. `node scripts/avocado-import.mjs dump.sql --members members.json
--media-base https://files.example.com --out import.json`
5. 운영 화면 맨 아래 **AvocadoEdition 가져오기**에서 `import.json`을
   고릅니다. 이미 있는 문서는 건너뛰므로 중간에 멈추면 다시 가져오면 됩니다.

비밀번호, 이메일, IP 같은 PHP 계정 정보는 읽지 않습니다. 아이템 효과는 다시
설정해야 합니다(변환기가 경고로 알려 줍니다).

## 롤플레이 (캐릭터로 쓰기·탐색·호출)

로그와 댓글을 내 캐릭터로 쓰면 이름, 표시 중인 타이틀, 입은 의상이 함께
남습니다. 주사위는 서버가 굴리고 수정해도 바뀌지 않습니다. 댓글에서
탐색(승인된 캐릭터, 한국 시간 기준 하루 횟수)과 아이템 사용을 할 수 있고,
`[[닉네임]]`으로 회원을 호출합니다. 호출과 내 글의 댓글은 **알림** 탭에
쌓입니다. 캐릭터에는 운영자가 정한 추가 프로필 항목과 수정 중 → 신청 → 승인
상태가 있고, 운영 화면의 **캐릭터 신청 심사**에서 승인합니다.

`neo_avocado_character_fields`, `neo_avocado_explore`, `neo_avocado_calls`
컬렉션을 읽기·쓰기 모두 **관리자만**으로 만들고 운영자로 다시 로그인하세요.
**기본 설정**의 하루 탐색 횟수(0이면 탐색 끔), **탐색 표**, 게시판의 **댓글
행동 허용**을 설정합니다. 자세한 내용은
[port-status.md](docs/port-status.md)의 "Roleplay core"를 참고하세요.

## 안내 페이지

`neo_avocado_content` 컬렉션을 읽기·쓰기 모두 **관리자만**으로 만들고 운영자로
다시 로그인하여 권한을 승인하세요. **내용 페이지**에서 제목, 본문 형식,
기본·모바일 본문, 상단·하단 이미지, 공개 여부와 읽기 등급을 설정합니다.
회원 화면 **안내**에서 선택해 읽습니다. 모바일 본문이 비어 있으면 기본 본문을
표시합니다. 본문은 각각 최대 12,000자입니다.

HTML은 [DOMPurify](https://github.com/cure53/DOMPurify)로 정리하여 표시합니다.
스크립트·폼·전체 페이지에 영향을 주는 스타일/ID/이름은 표시하지 않습니다.
원본의 PHP include와 skin 파일은 내용이나 정적 테마 구성요소로 옮겨야 합니다.
`npm run vendor:content`로 잠긴 의존성에서 배포용 자산을 갱신하고,
`npm run vendor:check`로 자산이 의존성과 일치하는지 검사합니다.

서버 함수 호출은 SDK 1.1.0의 `member.call("neo-avocado:함수", 인자)` 또는
`member.read("neo-avocado:함수", 인자)` 형식입니다. 하위 폴더가 있으면
`member.read("community/boards:list")`는 `_naru/functions/community/boards.js`의
`list`를 호출합니다. 파일 경로와 함수는 `:`로 구분합니다.

서버 함수는 `_naru/functions/`에 기능별로 나뉘어 있으며, 공통 코드는
`_naru/modules/shared.js`를 정적 import합니다. 별도의 번들 생성은 필요하지
않습니다. 자세한 구조는 [_naru/README.md](_naru/README.md)를 참고하세요.
