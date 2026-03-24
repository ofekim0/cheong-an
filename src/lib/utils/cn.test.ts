import { describe, expect, it } from 'vitest';

import { cn } from './cn';

describe('cn', () => {
  it('여러 클래스를 하나로 합친다', () => {
    expect(cn('flex', 'items-center')).toBe('flex items-center');
  });

  it('조건부 클래스를 처리한다', () => {
    expect(cn('flex', false && 'hidden', 'gap-2')).toBe('flex gap-2');
  });

  it('충돌하는 Tailwind 클래스를 머지한다', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
