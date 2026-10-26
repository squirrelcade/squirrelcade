import { describe, expect, it } from 'vitest';
import { amazonUnknown, isAmazonUnknown, orderPageDate, readAmazonHistory, readAmazonOrder, readOrderPage } from './amazon.js';

// Made-up emails and pages in the shapes Amazon sends and shows (no one's real order).
describe('Amazon (D176)', () => {
  it("reads its order email: the order, its total, and a video game whose name it doesn't give", () => {
    const text = 'Mark, thanks for your order!\nOrdered\nShipped\n2 items: 1 Video Games, 1 Electronics\nOrder #\n111-1234567-7654321\nView or edit order\nGrand Total:\n$32.39\n';
    const order = readAmazonOrder({ subject: 'Ordered 2 items: Video Games, Electronics', from: 'auto-confirm@amazon.com', day: '2026-10-24', text });
    expect(order).toMatchObject({ store: 'Amazon', orderNumber: '111-1234567-7654321', totalCents: 3239, link: 'https://www.amazon.com/your-orders/order-details?orderID=111-1234567-7654321' });
    expect(order!.items).toEqual([{ title: amazonUnknown('111-1234567-7654321'), priceCents: null, quantity: 1 }]);
    expect(isAmazonUnknown(order!.items[0]!.title)).toBe(true);
    // Two games in one order; no game at all; not Amazon's.
    expect(readAmazonOrder({ subject: 'Ordered 3 items: Video Games, Toys', from: 'auto-confirm@amazon.com', day: '2026-10-24', text: '3 items: 2 Video Games, 1 Toys\nOrder # 111-1234567-7654322' })!.items).toHaveLength(2);
    expect(readAmazonOrder({ subject: 'Ordered 1 item: Tools', from: 'auto-confirm@amazon.com', day: '2026-10-24', text: '1 item: 1 Tools' })).toBeNull();
    expect(readAmazonOrder({ subject: 'Ordered 1 item: Video Games', from: 'orders@notamazon.example', day: '2026-10-24', text: '' })).toBeNull();
  });

  it('reads an order page pasted from Amazon: its game, its price, the day it was placed', () => {
    const page = [
      'Order Details',
      'Order placed October 24, 2026',
      'Order # 111-1234567-7654321',
      'Ship to',
      'Pat',
      'Order Summary',
      'Item(s) Subtotal: $49.98',
      'Shipping & Handling: $0.00',
      'Total before tax: $49.98',
      'Estimated tax to be collected: $4.12',
      'Grand Total: $54.10',
      'Arriving today',
      'Star Squirrel Saga - PlayStation 5',
      'Sold by: Amazon.com Services LLC',
      'Return or replace items: Eligible through November 30, 2026',
      '$29.99',
      'Condition: New',
      'Buy it again',
      'Acorn Detective - Nintendo Switch',
      'Sold by: Amazon.com Services LLC',
      '$19.99',
      'Buy it again',
    ].join('\n');
    const order = readOrderPage(page, '2026-10-26');
    expect(order).toMatchObject({ store: 'Amazon', orderNumber: '111-1234567-7654321', date: '2026-10-24', taxCents: 412 });
    expect(order!.items).toEqual([
      { title: 'Star Squirrel Saga - PlayStation 5', priceCents: 2999, quantity: 1 },
      { title: 'Acorn Detective - Nintendo Switch', priceCents: 1999, quantity: 1 },
    ]);
    expect(orderPageDate('Order Submitted: 2/13/2026')).toBe('2026-02-13');
  });

  it("reads Amazon's order history download, its columns by name, cancelled items left out", () => {
    const csv = [
      '﻿Website,Order ID,Order Date,Currency,Unit Price,Unit Price Tax,Shipping Charge,Total Owed,ASIN,Quantity,Order Status,Product Name',
      'Amazon.com,111-0000001-0000001,2019-03-04T18:22:01Z,USD,39.99,3.20,0,43.19,B000000001,1,Closed,"Star Squirrel Saga - PlayStation 4"',
      'Amazon.com,111-0000002-0000002,2020-07-01T10:00:00Z,USD,12.50,1,0,13.50,B000000002,2,Closed,"USB-C Cable, 2 Pack"',
      'Amazon.com,111-0000003-0000003,2021-01-01T10:00:00Z,USD,59.99,4.80,0,64.79,B000000003,1,Cancelled,"Acorn Detective - Nintendo Switch"',
    ].join('\n');
    expect(readAmazonHistory(csv)).toEqual([
      { orderId: '111-0000001-0000001', date: '2019-03-04', productName: 'Star Squirrel Saga - PlayStation 4', unitPriceCents: 3999, quantity: 1, currency: 'USD', status: 'Closed' },
      { orderId: '111-0000002-0000002', date: '2020-07-01', productName: 'USB-C Cable, 2 Pack', unitPriceCents: 1250, quantity: 2, currency: 'USD', status: 'Closed' },
    ]);
    expect(readAmazonHistory('Title,Platform\nOkami,PS2')).toBeNull();
  });
});
