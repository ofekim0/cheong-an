/**
 * 청년안심주택 상세 페이지(view.do)가 비존재 boardId에 대해 반환하는
 * 200 OK + 633B 에러 안내 페이지를 판별한다.
 *
 * 실 사이트 응답 형태 (2026-05-20 확인):
 * - HTTP 200
 * - <title>에러안내</title>
 * - <script>로 alert("게시글에 대한 정보가 없습니다.") 후 history.back()
 *
 * 정상 view.do 응답에는 위 두 마커가 동시에 등장하지 않으므로,
 * 두 마커 중 하나라도 있으면 에러 페이지로 본다.
 */

export function isViewErrorPage(html: string): boolean {
  if (!html) return false;
  return (
    html.includes('<title>에러안내</title>') ||
    html.includes('게시글에 대한 정보가 없습니다')
  );
}
