import { describe, expect, it } from 'vitest';
import { readPurchaseSheet } from './purchaseSheet.js';

// A made-up sheet in the shape of an Amazon order history kept in a spreadsheet (no one's real orders).
describe('a purchases spreadsheet (D178)', () => {
  it('reads its columns by name, and knows a cancelled or returned item', () => {
    const rows = [
      ['Order date', 'Order #', 'Item', 'ASIN', 'Qty', 'Unit price', 'Line total', 'Sold by', 'Condition', 'Shipment status', 'Cancelled', 'Video game?', 'Product page'],
      ['2026-08-23', '111-0000001-0000001', 'Star Squirrel Saga - Nintendo Switch', 'B000000001', '1', '$19.99', '$19.99', 'Amazon.com', 'New', 'Delivered August 28', '', 'Yes', 'View'],
      ['2026-08-23', '111-0000001-0000001', 'USB-C cable', 'B000000002', '2', '$6.50', '$13.00', '', '', 'Delivered August 28', '', '', 'View'],
      ['2026-09-01', '111-0000002-0000002', 'Pro Controller', 'B000000003', '1', '$59.99', '$59.99', '', '', 'Return complete ; Return complete', '', 'Accessory/hardware', 'View'],
      ['2026-09-02', '111-0000003-0000003', 'Acorn Detective - PlayStation 5', 'B000000004', '1', '$39.99', '$39.99', '', '', 'Cancelled Your order was cancelled.', '', 'Yes', 'View'],
    ];
    const read = readPurchaseSheet(rows)!;
    expect(read.map((r) => [r.key, r.kind, r.gone, r.unitCents, r.quantity])).toEqual([
      ['111-0000001-0000001|B000000001', 'game', false, 1999, 1],
      ['111-0000001-0000001|B000000002', 'other', false, 650, 2],
      ['111-0000002-0000002|B000000003', 'hardware', true, 5999, 1],
      ['111-0000003-0000003|B000000004', 'game', true, 3999, 1],
    ]);
    expect(read[0]).toMatchObject({ date: '2026-08-23', item: 'Star Squirrel Saga - Nintendo Switch', seller: 'Amazon.com' });
    expect(readPurchaseSheet([['Title', 'Platform'], ['Okami', 'PS2']])).toBeNull();
  });
});
