import { describe, it, expect } from 'vitest';

import { urlBase64ToUint8Array } from './urlBase64ToUint8Array';

describe('urlBase64ToUint8Array', () => {
  it('패딩이 필요 없는 표준 문자열을 바이트 배열로 디코드한다', () => {
    // "AQID" → 0x01 0x02 0x03
    const result = urlBase64ToUint8Array('AQID');
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });

  it('길이가 4의 배수가 아니면 패딩을 복구해 디코드한다', () => {
    // "AQ"(길이 2) → "AQ==" → 0x01
    const result = urlBase64ToUint8Array('AQ');
    expect(Array.from(result)).toEqual([1]);
  });

  it('base64url 치환 문자(-, _)를 표준 base64로 복원한다', () => {
    // "__w" → "//w=" → 0xFF 0xFC (치환 + 패딩 동시 검증, 마지막 2비트는 버려짐)
    const result = urlBase64ToUint8Array('__w');
    expect(Array.from(result)).toEqual([255, 252]);
  });

  it('Uint8Array 인스턴스를 반환한다', () => {
    expect(urlBase64ToUint8Array('AQID')).toBeInstanceOf(Uint8Array);
  });

  it('빈 문자열은 빈 배열을 반환한다', () => {
    expect(urlBase64ToUint8Array('').length).toBe(0);
  });
});
