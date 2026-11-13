import { expect, it } from 'vitest';
import { printCsp } from './printSecurity';
it('denies script, file, frame and network access except an approved upload logo', () => {
  expect(printCsp()).toContain("script-src 'none'"); expect(printCsp()).toContain("img-src data:;");
  expect(printCsp('https://erp.example/uploads/logo.png')).toContain('img-src data: https://erp.example/uploads/logo.png');
  for (const url of ['file:///private/token', 'https://evil.example/a', 'http://localhost/admin', 'https://u:p@erp.example/uploads/logo.png', 'https://erp.example/uploads/logo.png?secret']) expect(() => printCsp(url)).toThrow();
});
