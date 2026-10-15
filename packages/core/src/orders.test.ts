import { describe, expect, it } from 'vitest';
import {
  gmailOrderSearch,
  itemCost,
  orderItemFor,
  orderItemScore,
  orderSearchTitles,
  ordersFromAnswer,
  orderStore,
  orderText,
  orderTextForModel,
  purchaseSubject,
  readOrderEmail,
  NOT_PURCHASE_SUBJECTS_DEFAULT,
  PURCHASE_SUBJECTS_DEFAULT,
  type FoundOrder,
} from './orders.js';

// Made-up emails in the shapes the stores send (no one's real order).
const EBAY_HTML = `<html><head><style>td{color:red}</style></head><body>
<table><tr><td>Order confirmed</td></tr>
<tr><td><a href="https://click.ebay.com/ck?loc=https%3A%2F%2Fwww.ebay.com%2Fitm%2F395512345678%3Fmkevt%3D1">Okami (Sony PlayStation 2, 2006) CIB Complete Tested</a></td></tr>
<tr><td>Order number:</td><td>12-34567-89012</td></tr>
<tr><td>Item price</td><td>$24.99</td></tr>
<tr><td>Quantity</td><td>1</td></tr>
<tr><td>Shipping</td><td>$4.99</td></tr>
<tr><td>Sales tax</td><td>$2.16</td></tr>
<tr><td>Order total</td><td>$32.14</td></tr>
<tr><td>Ship to</td><td>Pat Example<br>123 Main St<br>Springfield, ST 00000</td></tr>
</table></body></html>`;

const AMAZON_HTML = `<table>
<tr><td>Thanks for your order, Pat!</td></tr>
<tr><td>Order #112-1234567-7654321</td></tr>
<tr><td>Metroid Prime 4: Beyond - Nintendo Switch 2</td><td>Qty: 1</td><td>$69.99</td></tr>
<tr><td>Mario Kart World (Nintendo Switch 2)</td><td>Qty: 2</td><td>$159.98</td></tr>
<tr><td>Item(s) Subtotal:</td><td>$229.97</td></tr>
<tr><td>Shipping &amp; Handling:</td><td>$0.00</td></tr>
<tr><td>Estimated tax to be collected:</td><td>$18.40</td></tr>
<tr><td>Grand Total:</td><td>$248.37</td></tr>
</table>`;

const SHOPIFY_HTML = `<div>Order #LRG123456 confirmed</div><div>Thank you for your purchase!</div>
<table><tr><td>Shantae Advance: Risky Revolution (Switch) × 1</td><td>$34.99</td></tr>
<tr><td>Wild Guns Reloaded Classic Edition × 1</td><td>$59.99</td></tr></table>
<table><tr><td>Subtotal</td><td>$94.98</td></tr><tr><td>Discount</td><td>-$9.50</td></tr><tr><td>Shipping</td><td>$12.00</td></tr><tr><td>Taxes</td><td>$7.60</td></tr><tr><td>Total</td><td>$105.08 USD</td></tr></table>`;

const mail = (subject: string, from: string, html: string, fromName = '') => ({ subject, from, fromName, day: '2026-10-03', text: orderText(html) });

describe('order emails', () => {
  it("reads a single-item eBay purchase, with its listing and its order's amounts", () => {
    const order = readOrderEmail({ ...mail('Order confirmed: Okami (Sony PlayStation 2, 2006) CIB Complete Tested', 'ebay@ebay.com', EBAY_HTML), links: 'https://click.ebay.com/ck?loc=https%3A%2F%2Fwww.ebay.com%2Fitm%2F395512345678%3Fmkevt%3D1' })!;
    expect(order).toMatchObject({
      store: 'eBay',
      date: '2026-10-03',
      orderNumber: '12-34567-89012',
      currency: 'USD',
      items: [{ title: 'Okami (Sony PlayStation 2, 2006) CIB Complete Tested', priceCents: 2499, quantity: 1 }],
      taxCents: 216,
      shippingCents: 499,
      totalCents: 3214,
      link: 'https://www.ebay.com/itm/395512345678',
      readBy: 'plain',
    });
    // Looked for by the game's title, the same.
    const found = readOrderEmail(mail('Order confirmed: Okami (Sony PlayStation 2, 2006) CIB Complete Tested', 'ebay@ebay.com', EBAY_HTML), 'Okami')!;
    expect(found.items[0]).toMatchObject({ priceCents: 2499 });
  });

  it('finds the game asked for among several items, each with its price for one', () => {
    const m = mail('Your Amazon.com order of "Metroid Prime 4: Beyond..." and 1 more item', 'auto-confirm@amazon.com', AMAZON_HTML);
    const mario = readOrderEmail(m, 'Mario Kart World')!;
    // The game asked for first, then the order's other items (its tax and shipping are shared over them all).
    expect(mario.items).toEqual([{ title: 'Mario Kart World (Nintendo Switch 2)', priceCents: 7999, quantity: 2 }, { title: 'Metroid Prime 4: Beyond - Nintendo Switch 2', priceCents: 6999, quantity: 1 }]);
    expect(mario).toMatchObject({ store: 'Amazon', orderNumber: '112-1234567-7654321', taxCents: 1840, shippingCents: 0, totalCents: 24837 });
    const metroid = readOrderEmail(m, 'Metroid Prime 4: Beyond')!;
    expect(metroid.items[0]).toMatchObject({ priceCents: 6999, quantity: 1 });
    // Not asked for one: every line with a price that isn't the summary's.
    expect(readOrderEmail(m)!.items.map((i) => [i.priceCents, i.quantity])).toEqual([[6999, 1], [7999, 2]]);
  });

  it("shares an order's tax, shipping and discount out by the items' prices, as the setting counts the price paid", () => {
    const order: FoundOrder = { store: 'Limited Run Games', date: '2026-10-03', orderNumber: 'LRG123456', currency: 'USD', items: [{ title: 'A', priceCents: 2000, quantity: 1 }, { title: 'B', priceCents: 3000, quantity: 2 }], taxCents: 800, shippingCents: 1000, discountCents: 400, totalCents: 9400, link: null, readBy: 'plain' };
    // B is 3000 of the 8000 for each copy: 3/8 of the tax, the shipping and the discount.
    expect(itemCost(order, 1, 'item')).toEqual({ itemCents: 3000, taxCents: 300, shippingCents: 375, discountCents: 150, paidCents: 3000 });
    expect(itemCost(order, 1, 'tax').paidCents).toBe(3300);
    expect(itemCost(order, 1, 'all').paidCents).toBe(3525);
    expect(itemCost(order, 0, 'all').paidCents).toBe(2000 + 200 + 250 - 100);
    // No price for the item: no price paid.
    expect(itemCost({ ...order, items: [{ title: 'C', priceCents: null, quantity: 1 }] }, 0, 'all').paidCents).toBeNull();
  });

  it("reads a Shopify store's order: its items, discount, shipping and taxes", () => {
    const order = readOrderEmail(mail('Order #LRG123456 confirmed', 'store@limitedrungames.com', SHOPIFY_HTML), 'Wild Guns Reloaded')!;
    expect(order).toMatchObject({ store: 'Limited Run Games', orderNumber: 'LRG123456', discountCents: 950, shippingCents: 1200, taxCents: 760, totalCents: 10508 });
    expect(order.items).toEqual([{ title: 'Wild Guns Reloaded Classic Edition × 1', priceCents: 5999, quantity: 1 }, { title: 'Shantae Advance: Risky Revolution (Switch) × 1', priceCents: 3499, quantity: 1 }]);
  });

  it("isn't fooled by an ad that names the game", () => {
    const ad = mail('Okami HD is 50% off this weekend!', 'deals@games.example', '<p>Okami HD now $9.99. Shop now!</p>');
    expect(readOrderEmail(ad, 'Okami HD')).toBeNull();
  });

  it('names stores by their address, else by the sender', () => {
    expect(orderStore('ebay@ebay.com')).toBe('eBay');
    expect(orderStore('no-reply@mail.mercari.com')).toBe('Mercari');
    expect(orderStore('orders@shop.example.com', 'Retro Corner')).toBe('Retro Corner');
    expect(orderStore('noreply@retrocorner.example')).toBe('retrocorner');
  });

  it("scores an order's item against a game's title: listing words don't count, a sequel's number does", () => {
    expect(orderItemScore('Okami (Sony PlayStation 2, 2006) CIB Complete Tested', 'Okami')).toBe(1);
    expect(orderItemScore('Final Fantasy VII Remake PS4', 'Final Fantasy 7 Remake')).toBe(1);
    expect(orderItemScore('Halo 3 Xbox 360 Complete', 'Halo')).toBeLessThan(0.75);
    expect(orderItemScore('Super Mario Odyssey', 'Mario Kart 8 Deluxe')).toBeLessThan(0.75);
    const order = readOrderEmail(mail('x', 'auto-confirm@amazon.com', AMAZON_HTML))!;
    expect(orderItemFor(order, 'Mario Kart World')).toBe(1);
    expect(orderItemFor(order, 'Zelda')).toBeNull();
  });

  it("searches Gmail with the title as a phrase and the order words, and a subtitle's main title too", () => {
    expect(gmailOrderSearch("Uncharted 3: Drake's Deception", ['order', 'receipt', 'order confirmation'], 365, 5)).toBe('"uncharted 3 drakes deception" {order receipt "order confirmation"} newer_than:365d smaller:5M');
    expect(orderSearchTitles("Uncharted 3: Drake's Deception")).toEqual(["Uncharted 3: Drake's Deception", 'Uncharted 3']);
    expect(orderSearchTitles('Okami')).toEqual(['Okami']);
  });

  it("checks the AI model's answer: purchases only, numbers as cents, a real day", () => {
    const mails = [mail('a', 'ebay@ebay.com', EBAY_HTML), mail('b', 'x@example.com', '<p>hi</p>')];
    const answer = {
      orders: [
        { email: 1, purchase: true, store: 'eBay', date: '2026-10-02', orderNumber: '12-34567-89012', currency: 'usd', items: [{ title: 'Okami PS2', price: 24.99, quantity: 1 }, { title: 'Bad', price: 'lots' }], tax: 2.16, shipping: 4.99, total: 32.14 },
        { email: 2, purchase: false },
        { email: 7, purchase: true, items: [{ title: 'Nothing' }] },
      ],
    };
    const [one, two] = ordersFromAnswer(answer, mails);
    expect(one).toMatchObject({ store: 'eBay', date: '2026-10-02', currency: 'USD', items: [{ title: 'Okami PS2', priceCents: 2499, quantity: 1 }, { title: 'Bad', priceCents: null, quantity: 1 }], taxCents: 216, shippingCents: 499, totalCents: 3214, readBy: 'ai' });
    expect(two).toBeNull();
    expect(ordersFromAnswer('nonsense', mails)).toEqual([null, null]);
  });

  it("leaves addresses, phone numbers and the lines of a postal address out of what goes to a model", () => {
    const text = orderTextForModel(orderText(`${EBAY_HTML}<p>Questions? pat@example.com or 555-123-4567</p>`));
    expect(text).toContain('Order total\t$32.14');
    expect(text).not.toMatch(/123 Main St|Springfield|pat@example\.com|555-123-4567/);
  });

  it("isn't fooled by a title's last letters, a title's X, a unit price, Amazon's \"Total before tax\" or an item without a price", () => {
    // "Zelda $24.99" is US dollars (no Australian "a"), and the title stays whole.
    const zelda = readOrderEmail(mail('Order confirmed', 'ebay@ebay.com', '<table><tr><td>The Legend of Zelda</td><td>$24.99</td></tr><tr><td>Order total</td><td>$27.99</td></tr></table>'), 'The Legend of Zelda')!;
    expect(zelda.items[0]).toMatchObject({ title: 'The Legend of Zelda', priceCents: 2499 });
    // Mega Man X4 is one game, not four.
    const megaMan = readOrderEmail(mail('Thanks for your order', 'orders@shop.example.com', '<table><tr><td>Mega Man X4 (PS1)</td><td>$29.99</td></tr></table>'), 'Mega Man X4')!;
    expect(megaMan.items[0]).toMatchObject({ priceCents: 2999, quantity: 1 });
    // A unit price is for one, whatever the quantity.
    const unit = readOrderEmail(mail('Thanks for your order', 'orders@shop.example.com', '<table><tr><td>Okami HD</td></tr><tr><td>Unit price</td><td>$25.00</td></tr><tr><td>Quantity: 2</td></tr></table>'), 'Okami HD')!;
    expect(unit.items[0]).toMatchObject({ priceCents: 2500, quantity: 2 });
    // Amazon: "Items:" and "Total before tax" are the items' total, not an item or the tax.
    const amazon = readOrderEmail(mail('Ordered: "Okami HD"', 'auto-confirm@amazon.com', '<table><tr><td>Okami HD</td><td>$19.99</td></tr><tr><td>Items:</td><td>$19.99</td></tr><tr><td>Total before tax:</td><td>$19.99</td></tr><tr><td>Estimated tax to be collected:</td><td>$1.60</td></tr><tr><td>Order total:</td><td>$21.59</td></tr></table>'), 'Okami HD')!;
    expect(amazon).toMatchObject({ taxCents: 160, totalCents: 2159, items: [{ priceCents: 1999 }] });
    expect(itemCost(amazon, 0, 'tax').paidCents).toBe(2159);
    // An item without a price: the tax and shipping go equally to each copy.
    const unpriced: FoundOrder = { store: 'x', date: null, orderNumber: null, currency: null, items: [{ title: 'A', priceCents: 2000, quantity: 1 }, { title: 'B', priceCents: null, quantity: 1 }], taxCents: 800, shippingCents: 1000, discountCents: null, totalCents: null, link: null, readBy: 'plain' };
    expect(itemCost(unpriced, 0, 'all').paidCents).toBe(2000 + 400 + 500);
    // Gmail's phrase keeps a title's words, "&" left out as Gmail leaves it out.
    expect(gmailOrderSearch('Ratchet & Clank', ['order'], 30, 5)).toBe('"ratchet clank" {order} newer_than:30d smaller:5M');
  });

  it("tells a purchase's subject from a shipping notice's or a sale's", () => {
    const yes = PURCHASE_SUBJECTS_DEFAULT;
    const no = NOT_PURCHASE_SUBJECTS_DEFAULT;
    expect(purchaseSubject('Order confirmed: Okami PS2', yes, no)).toBe(true);
    expect(purchaseSubject('Your order has shipped: Okami PS2', yes, no)).toBe(false);
    expect(purchaseSubject('You made the sale for Halo 3', yes, no)).toBe(false);
    expect(purchaseSubject('New items from sellers you follow', yes, no)).toBe(false);
    // The words not counted are whole words, outside the item's own name.
    expect(purchaseSubject('Order confirmed: Overwatch Origins Edition', yes, no)).toBe(true);
    expect(purchaseSubject('Order confirmed: Watch Dogs PS4', yes, no)).toBe(true);
    expect(purchaseSubject('You purchased Returnal PS5', yes, no)).toBe(true);
    expect(purchaseSubject('Order confirmed: Toy Soldiers', yes, no)).toBe(true);
  });
});
