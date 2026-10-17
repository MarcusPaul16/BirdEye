import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats an amount in a currency with a proper separator for code-style currencies ("RON 12,900", "CHF 82.43", "$529.05").
 * Takes the same arguments as Angular's currency pipe so it can replace it: (code, display, digitsInfo).
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, code = 'USD', _display?: string, digitsInfo?: string): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '';
    let min = 2, max = 2;
    const m = digitsInfo ? /^\d+\.(\d+)-(\d+)$/.exec(digitsInfo) : null;
    if (m) { min = +m[1]; max = +m[2]; }
    try {
      const format = (display: 'narrowSymbol' | 'code') =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: display, minimumFractionDigits: min, maximumFractionDigits: max }).format(value);
      const text = format('narrowSymbol');
      // Single-glyph symbols ($, €, £) read well; word-like ones ("lei", "zł") do not, so those use the ISO code ("RON 12,900").
      return /\p{L}{2,}/u.test(text.replace(/[\d.,\s]/g, '')) ? format('code') : text;
    } catch {
      return `${value.toFixed(max)} ${code}`; // unknown currency code
    }
  }
}
