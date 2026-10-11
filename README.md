# neo-avocado

네오 아보카도는 자캐 커뮤니티 솔루션 [아보카도 에디션](https://github.com/tateck-develop/AvocadoEdition)의 뼈대를 나루 회원과 서버 함수(데이터 SDK 1.1.0)로 다시 만든 사이트입니다. 회원 로그인과 닉네임, 캐릭터 등록, 그림 로그와 댓글, 댓글 주사위, 출석 보상과 상점·뽑기·인벤토리가 있습니다.

## 구조

| 파일                                                               | 하는 일                                                   |
| ------------------------------------------------------------------ | --------------------------------------------------------- |
| `index.html`, `app.js`, `style.css`                                | 페이지                                                    |
| `config.js`                                                        | 나루 로그인 이름. `<login>.naru.pub`에서는 비워 둡니다.   |
| [`_naru/functions/neo-avocado.js`](_naru/functions/neo-avocado.js) | 서버 함수: 출석 보상(`daily`), 사기(`buy`), 뽑기(`gacha`) |

돈과 아이템을 바꾸는 규칙은 서버 함수에만 있습니다. 나루가 이 파일을 회원의 브라우저가 아니라 서버에서, 한 트랜잭션 안에서 돌리고, 페이지는 `member.call("neo-avocado/buy", …)`처럼 부르기만 합니다. 함수 파일은 사이트와 함께 배포되고 누구나 볼 수 있으니 비밀값을 넣지 마세요.

## 컬렉션

제어판의 데이터베이스에서 아래 컬렉션을 만드세요. 회원은 나루 계정으로 로그인한 방문자이고, 회원이 쓰는 컬렉션에서는 자기가 만든 문서만 고치고 지웁니다.

| 컬렉션                   | 읽기 | 쓰기     | 담는 것                                                                                          |
| ------------------------ | ---- | -------- | ------------------------------------------------------------------------------------------------ |
| `neo_avocado_profiles`   | 회원 | 회원     | 회원마다 하나, 회원 번호를 ID로: 닉네임                                                          |
| `neo_avocado_characters` | 회원 | 회원     | 캐릭터 시트                                                                                      |
| `neo_avocado_logs`       | 회원 | 회원     | 그림 로그                                                                                        |
| `neo_avocado_comments`   | 회원 | 회원     | 로그의 댓글(`logId`)과 주사위                                                                    |
| `neo_avocado_items`      | 회원 | 관리자만 | 상점 아이템: `name`, `price`, 선택으로 `stock`(없으면 무제한), `description`, `hidden`           |
| `neo_avocado_gacha`      | 회원 | 관리자만 | 뽑기 표: `item`(아이템 ID), `weight`(나올 비율)                                                  |
| `neo_avocado_wallets`    | 회원 | 관리자만 | 회원마다 하나, 회원 번호를 ID로: `balance`, `lastDaily`. 출석 보상은 하루 100, 뽑기는 한 번에 50 |
| `neo_avocado_inventory`  | 회원 | 관리자만 | 회원이 산 것과 뽑은 것: `owner`, `item`, `name`, `from`                                          |

아이템과 뽑기 표는 관리자가 제어판에서 채웁니다. 주사위 눈은 서버가 댓글에 붙인 ID에서 정해지므로 회원이 고를 수 없습니다. 다만 회원은 자기 댓글을 지울 수 있어서, 지우고 다시 굴리는 것까지 막지는 못합니다.

## 배포

`main`에 푸시하면 `.github/workflows/deploy.yml`이 `npm run lint`와 `npm test`를 돌리고, 통과할 때만 페이지와 `_naru/`를 사이트 루트에 배포합니다. GitHub Actions OIDC를 쓰므로 비밀값은 필요 없고, 저장소 변수 `NARU_SITE`에 나루 로그인 이름이 들어 있습니다. 사이트에 있지만 저장소에 없는 파일은 배포할 때 지워집니다.

## 개발

```
npm ci
npm test      # 페이지가 보내는 질의와 서버 함수의 규칙을 검사합니다
npm run lint  # Prettier 형식 검사
```

`does78teux.naru.pub`의 `neo-avocado/`에서 옮겨 왔습니다.
