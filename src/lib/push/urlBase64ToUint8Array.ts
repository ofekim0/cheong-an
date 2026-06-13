/**
 * VAPID public key (base64url 문자열)를 PushManager.subscribe의
 * applicationServerKey 파라미터에 넣을 수 있는 Uint8Array로 변환한다.
 *
 * web-push가 생성하는 VAPID 공개키는 base64url 형식이지만
 * atob는 표준 base64만 받으므로 패딩 복구 + 문자 치환 후 디코드한다.
 */
export function urlBase64ToUint8Array(base64UrlString: string): Uint8Array {
  const padding = '='.repeat((4 - (base64UrlString.length % 4)) % 4);
  const base64 = (base64UrlString + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}
