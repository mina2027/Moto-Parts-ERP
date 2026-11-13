import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const require = createRequire(path.join(root, 'erp-frontend/package.json'));
const { build } = require('esbuild');
const playwrightPath = process.env.PLAYWRIGHT_MODULE ?? path.join(os.tmpdir(), 'cg-shots/node_modules/playwright-core/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const { getDocument } = await import(pathToFileURL(path.join(os.tmpdir(), 'moto-print-check/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
const evidence = path.join(root, 'audit/evidence/invoice-exact-size');
fs.mkdirSync(evidence, { recursive: true });

const bundle = await build({
  stdin: {
    resolveDir: path.join(root, 'erp-frontend'), loader: 'tsx', contents: `
      import * as React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { SalesInvoiceA4 } from './packages/pos-core/src/print/SalesInvoiceA4';
      import { SalesInvoiceThermal } from './packages/pos-core/src/print/SalesInvoiceThermal';
      import { SAMPLE_INVOICE, SAMPLE_STORE } from './packages/pos-core/src/test/fixtures/sampleInvoice';
      import { printBrowserInvoice } from './src/lib/invoicePrint';
      import { defaultPrintProfiles } from '@moto/shared';
      window.runInvoiceCase = async ({ paper, count, long }) => {
        const thermal = paper.startsWith('thermal');
        const ref = React.createRef();
        const invoice = { ...SAMPLE_INVOICE, number: 'INV-2026-12345678901234567890',
          customer: { name: long ? 'اسم عميل طويل جداً '.repeat(15) : 'عميل نقدي', saleType: 'cash', id: 'CUSTOMER012345678901234567890' },
          items: Array.from({length: count}, (_, i) => ({ ...SAMPLE_INVOICE.items[0],
            name: 'ROW' + String(i).padStart(4, '0') + ' ' + (long ? 'قطعة غيار لمحرك الدراجة النارية '.repeat(8) + ' NAME_END' + i : 'قطعة غيار'),
            sku: long ? 'SKU'.repeat(30) + ' SKU_END' + i : 'SKU0000123456789',
            note: long ? 'NOTE0123456789'.repeat(8) + ' NOTE_END' + i : undefined,
            qty: long ? 12345 : 1, unitPrice: long ? 987654321.99 : 100,
          })), paid: long ? 999999999999999 : 100 * count, paymentMethod: long ? 'BANK_REFERENCE_'.repeat(15) : 'نقدي',
        };
        const store = { ...SAMPLE_STORE, thanks: 'END_OF_INVOICE',
          ...(long ? { name: 'مؤسسة قطع غيار الدراجات النارية '.repeat(3),
            address: 'عنوان المتجر الطويل بالتفصيل '.repeat(10),
            subtitle: 'خدمة وصيانة وتجارة قطع الغيار '.repeat(5),
            phones: ['+201234567890', '+201234567891', '+201234567892'],
          } : {}),
        };
        const host = document.createElement('div');
        host.style.cssText = 'width:1000px;height:100px;overflow:hidden;position:fixed;left:-10000px;top:0';
        document.body.append(host);
        flushSync(() => createRoot(host).render(thermal
          ? <SalesInvoiceThermal ref={ref} invoice={invoice} store={store}  />
          : <SalesInvoiceA4 ref={ref} invoice={invoice} store={store}  />));
        await new Promise(resolve => setTimeout(resolve, 100));
        window.print = () => {
          const printRoot = document.querySelector('.invoice-print-document');
          window.printedDocument = '<html><head><style>html,body{height:100%}body *{visibility:hidden}</style></head><body>'
            + printRoot.outerHTML + document.body.lastElementChild.outerHTML + '</body></html>';
        };
        await printBrowserInvoice(ref.current, defaultPrintProfiles().find(p => p.paper === paper));
        return window.printedDocument;
      };
    `,
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
});
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe'), headless: true,
});
const results = [];
try {
  for (const paper of ['thermal80', 'a4']) {
    for (const [kind, count, long] of [['short', 1, false], ['many', 75, false], ['long-fields', 8, true]]) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
      await page.setContent('<html><body></body></html>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const preview = await page.evaluate(args => {
        return window.runInvoiceCase(args).then(() => {
          const box = document.querySelector('.invoice').getBoundingClientRect();
          return { widthMm: box.width * 25.4 / 96, heightMm: box.height * 25.4 / 96 };
        });
      }, { paper, count, long });
      assert(Math.abs(preview.widthMm - (paper === 'a4' ? 210 : 80)) < 0.01, 'Preview does not match paper width');
      if (paper === 'a4' && kind === 'short') assert(Math.abs(preview.heightMm - 297) < 0.01, 'Short A4 canvas does not match paper height');
      const html = await page.evaluate(args => window.runInvoiceCase(args), { paper, count, long });
      await page.setContent(html);
      fs.writeFileSync(path.join(evidence, paper + '-' + kind + '.html'), await page.locator('.invoice').evaluate(element => element.outerHTML));
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.fonts.ready);
      const width = paper === 'thermal80' ? 80 : 210;
      const margin = 0;
      const contentWidth = (width - margin * 2) * 96 / 25.4;
      await page.setViewportSize({ width: Math.floor(contentWidth), height: 900 });
      const overflow = await page.evaluate(() => {
        const invoice = document.querySelector('.invoice');
        const box = invoice.getBoundingClientRect();
        const walker = document.createTreeWalker(invoice, NodeFilter.SHOW_TEXT);
        const problems = [];
        for (let node; (node = walker.nextNode());) {
          if (!node.textContent.trim() || node.parentElement.closest('style,svg')) continue;
          const range = document.createRange(); range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.left < box.left - 1 || rect.right > box.right + 1) problems.push(node.textContent.slice(0, 50));
          }
        }
        return [...new Set(problems)];
      });
      assert.deepEqual(overflow, [], paper + '/' + kind + ': text outside invoice');
      const file = path.join(evidence, paper + '-' + kind + '.pdf');
      const pdf = await page.pdf({ path: file, printBackground: true, preferCSSPageSize: true, tagged: true });
      const parsed = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
      let allText = '';
      for (let n = 1; n <= parsed.numPages; n++) {
        const pdfPage = await parsed.getPage(n);
        assert(Math.abs(pdfPage.view[2] * 25.4 / 72 - width) < 0.2, 'PDF paper width mismatch');
        if (paper === 'a4') assert(Math.abs(pdfPage.view[3] * 25.4 / 72 - 297) < 0.2, 'A4 paper height mismatch');
        const text = await pdfPage.getTextContent();
        allText += text.items.map(item => item.str ?? '').join('');
        for (const item of text.items) {
          if (!item.str?.trim()) continue;
          const x = item.transform[4], y = item.transform[5];
          assert(x >= -1 && x + item.width <= pdfPage.view[2] + 1, paper + '/' + kind + ': PDF text outside width');
          assert(y >= -1 && y <= pdfPage.view[3] + 1, paper + '/' + kind + ': PDF text outside height');
        }
      }
      const normalized = allText.replace(/\s/g, '');
      for (let i = 0; i < count; i++) assert(normalized.includes('ROW' + String(i).padStart(4, '0')), paper + '/' + kind + ': missing item ' + i);
      if (long) for (let i = 0; i < count; i++) {
        assert(normalized.includes('NAME_END' + i), paper + '/' + kind + ': clipped item name ' + i);
        assert(normalized.includes('NOTE_END' + i), paper + '/' + kind + ': clipped item note ' + i);
        if (!paper.startsWith('thermal')) assert(normalized.includes('SKU_END' + i), paper + '/' + kind + ': clipped SKU ' + i);
      }
      assert(normalized.includes('END_OF_INVOICE'), paper + '/' + kind + ': missing footer');
      if (paper.startsWith('thermal')) assert.equal(parsed.numPages, 1, 'Roll receipt split across pages');
      if (paper === 'a4' && kind === 'short') assert.equal(parsed.numPages, 1, 'Short A4 invoice has an extra blank page');
      if (!paper.startsWith('thermal') && kind === 'many') assert(parsed.numPages > 1, 'Long sheet invoice was not paginated');
      if (kind === 'short') await page.screenshot({ path: path.join(evidence, paper + '.png'), fullPage: true });
      results.push({ paper, kind, items: count, pages: parsed.numPages, complete: true, preview });
      console.log(JSON.stringify(results.at(-1)));
      await parsed.cleanup();
      await page.close();
    }
  }
} finally {
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
