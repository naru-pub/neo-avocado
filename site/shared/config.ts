// <login>.naru.pub과 커스텀 도메인에서는 페이지가 자기 사이트를 알아내므로 비워
// 둔다(shared/connect.ts). 그 밖의 곳, 이를테면 로컬 서버에서는 나루 로그인
// 이름을 적는다.
export const config = {
  site: "",
};
