import { describe, expect, it } from 'vitest';
import {
  gmailOrderSearch,
  gmailPurchaseSearch,
  senderDomain,
  storesSeen,
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
    expect(order.items).toEqual([{ title: 'Wild Guns Reloaded Classic Edition', priceCents: 5999, quantity: 1 }, { title: 'Shantae Advance: Risky Revolution (Switch)', priceCents: 3499, quantity: 1 }]);
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

// Made-up emails in the shapes the stores sent in 2026 (and Limited Run Games in 2023): their HTML breaks its lines
// inside a cell, as the real ones do. No one's real order, name, address or number.
const EBAY_2026 = `<div>ETA: Mon, Oct 5 - Fri, Oct 9. Look out for an update with the shipping confirmation.</div>
<div>&zwnj; &zwnj; &shy; &zwnj;</div>
<h3>Your order will ship to:</h3>
<p>Pat Example<br>1 Example Way<br>Springfield, 00000 ST<br>United States</p>
<h2>Your order details</h2>
<p><a href="https://www.ebay.com/itm/123456789012">Chrono Trigger (Nintendo DS, 2008) Complete CIB Tested</a></p>
<table><tr><td>
<h4>
Price:
</h4>
<p><b>$21.50</b></p></td><td><p><b>$21.50</b></p></td></tr>
<tr><td><h4>Item ID:</h4><p>123456789012</p></td></tr>
<tr><td><h4>Order number:</h4><p>01-23456-78901</p></td></tr></table>
<h2>Popular in your interests</h2>
<div>Chrono Cross (Pla…</div><div>$40.00</div><div>Or Best Offer</div>
<div>Lot Of 5 (Nin…</div><div>$25.00</div><div>Buy it now</div><div>Free shipping</div>
<h2>Sponsored items to complement your purchase</h2>
<div>Chrono Trigger (S…</div><div>$90.00</div><div>Buy it now</div>
<h3>Order total:</h3>
<table>
<tr>
<th>
Subtotal
</th>
<td>
$21.50
</td>
</tr>
<tr><th>
Shipping
</th><td>
$5.00
</td></tr>
<tr><th>
Sales tax
</th><td>
$1.60
</td></tr>
<tr><th>
Total charged to
<img alt="card">
</th><td>
$28.10
</td></tr>
</table>
<p>&copy; 1995-2026 eBay Inc. or its affiliates</p>`;

const MERCARI_2026 = `<p>Your order is confirmed.</p>
<p>The seller has confirmed your order for Okami HD Nintendo Switch Game ! Expect a shipping confirmation email soon.</p>
<h3>Item details</h3>
<p>Okami HD Nintendo Switch Game</p>
<p>ID: m12345678901</p>
<table><tr><td>
<p>Item price</p><div></div><p>Buyer protection fee</p><div></div><p>Tax</p>
</td><td align="right">
<p>$30.00</p><div></div><p>$1.20</p><div></div><p>$2.40</p>
</td></tr></table>
<table><tr><td>Total amount paid</td><td>$33.60</td></tr></table>
<p>Shipping from</p><p>Example City, ST</p>`;

const AMAZON_2026 = `<div>Ordered 1 item: Video Games</div>
<p>Thanks for your order!</p>
<p>Arriving October 25</p>
<p>1 item: Video Games</p>
<p>Pat - Springfield, ST</p>
<p>Order # &#8235;123-4567890-1234567</p>
<table><tr><td>Grand Total:</td><td>$31.82</td></tr></table>`;

const gameStopItem = (title: string, price: string) => `<table><tr><td><img></td><td>
<p>
${title}
</p>
<table><tr><td><p></p></td></tr><tr><td><p>
QTY: 1
</p></td><td><p><strong>${price}</strong></p></td></tr></table></td></tr></table>`;
const GAMESTOP_2026 = `<p>Thank you for your order, Pat</p>
<p>Order Number: 1100000000000001</p>
<p>Order Date: 10/1/26</p>
<div><p>Order Total</p><p>$43.20</p></div>
<p>Total Savings <span>$10.00</span></p>
<p>SHIP TO HOME</p><p>Shipping to</p><p>1 EXAMPLE WAY,</p><p>SPRINGFIELD, ST, 00000</p>
${gameStopItem('Okami HD - Nintendo Switch', '$20.00')}
${gameStopItem('Call of Duty: World at War - Wii', '$12.00')}
${gameStopItem('Ghost Trick: Phantom Detective - PlayStation 4', '$18.00')}
<p>We will send you tracking information when your order has shipped.</p>
<p>ORDER SUMMARY</p>
<table><tr><td><p>Subtotal</p></td><td><p>$50.00</p></td></tr>
<tr><td><p>Total Discount</p></td><td><p>$10.00</p></td></tr>
<tr><td><p>Shipping &amp; Handling</p></td><td><p>$0.00</p></td></tr>
<tr><td><p>Total Fees</p></td><td><p>$0.00</p></td></tr>
<tr><td><p>Estimated Tax</p></td><td><p>$3.20</p></td></tr></table>
<table><tr><td><p>Estimated Total</p></td><td><p>$43.20</p></td></tr></table>
<p>Total Savings <span>$10.00</span></p>
<p>Payment Method</p><p>Other</p><p>Amount: $43.20</p>`;

const LRG_2023 = `<p>Your order is CONFIRMED!</p>
<p>Order No. #1234567</p><p>October 1, 2023</p>
<h3>Items ordered</h3>
<table><tr><td>
<p>Switch Limited Run #88: River City Girls</p>
<p>esrb_rating: esrb-t.svg</p>
<p>esrb_list: Violence|Language|</p>
<p>upsell_id: 40000000000000</p>
<p>upsell_title: Protective Case</p>
<p>upsell_price: 1999</p>
</td><td><p>x 1</p></td><td><p>$34.99</p></td></tr></table>
<table><tr><td>Subtotal</td><td>$34.99</td></tr>
<tr><td>Calculated Shipping Rate</td><td>$6.00</td></tr>
<tr><td>Example County Tax (0.5%)</td><td>$0.17</td></tr>
<tr><td>Example State Tax (5.6%)</td><td>$1.96</td></tr>
<tr><td>Total</td><td>$43.12</td></tr></table>
<p>Payment Info</p><p>Mastercard (••••0000)</p><p>$43.12</p>
<p>Shipping Address</p><p>Pat Example</p><p>1 Example Way</p><p>Springfield, ST 00000</p><p>United States</p><p>Tel. +15550000000</p>
<p>Customer</p><p>Pat Example</p><p>1 Example Way</p><p>Springfield, ST 00000</p><p>United States</p>
<p>Copyright © 2023</p><p>$34.99</p><p>Shipping</p><p>$6.00</p><p>Example County Tax</p><p>$0.17</p><p>Example State Tax</p><p>$1.96</p><p>Total</p><p>$43.12 USD</p>
<p>Payment Method</p><p>Ending in 0000 — $43.12</p>`;

const LRG_2025 = `<h3>Items ordered</h3>
<table><tr><th><img alt="Blaster Master Zero Trilogy - Switch"></th><th><table><tbody><tr><th>
<p> <a href="https://limitedrungames.example/item"> Blaster Master Zero Trilogy (Switch, PS5) </a> <br/>
<span>Switch</span> <br/>
<span>🟣 Estimated ship date Jan 1 – Mar 31, 2027</span> </p></th>
<th><p>x 1</p></th>
<th><p> $29.99 </p></th></tr></tbody></table></th></tr>
<tr><th><table><tbody><tr><th>Subtotal</th><th>$29.99</th></tr>
<tr><th>Calculated Shipping Rate</th><th>$7.00</th></tr>
<tr><th>Example State Tax (5.6%)</th><th>$1.68</th></tr>
<tr><th>Example County Tax (0.5%)</th><th>$0.15</th></tr>
<tr><th>Total</th><th>$38.82</th></tr></tbody></table></th></tr></table>
<p>Payment Info</p><p>Example payments</p><p>$38.82</p>`;

const SRG_2026 = `<span class="order-number__text">
Order #100001
</span>
<h2>Thank you for your purchase! </h2>
<h3>Order summary</h3>
<table><tr><td><img></td><td>
<span>[CLUB] PB#12: Lone Ruin, Game #120 (Switch) - Exclusive Slipcover! × 1</span><br/>
</td><td>
<p>
£40.00
</p>
</td></tr></table>
<table><tr><td><p><span>Subtotal</span></p></td><td><strong>£40.00</strong></td></tr>
<tr><td><p><span>Shipping</span></p></td><td><strong>£9.99</strong></td></tr>
<tr><td><p><span>Duties</span></p></td><td><strong>£4.00</strong></td></tr>
<tr><td><p><span>Taxes</span></p></td><td><strong>£0.00</strong></td></tr></table>
<table><tr><td><p><span>Total</span></p></td><td><strong>£53.99 GBP</strong></td></tr></table>`;

describe("the stores' real emails, as they're shaped", () => {
  it("reads eBay's: the whole title the subject cuts short, its line breaks inside a cell, and not its suggestions", () => {
    const text = orderText(EBAY_2026);
    expect(text).toContain('Subtotal\t$21.50');
    expect(text).not.toMatch(/&zwnj;|&shy;/);
    const m = { subject: 'Order confirmed: Chrono Trigger (Nintendo DS, 2...', from: 'ebay@ebay.com', day: '2026-10-03', text, links: 'https://www.ebay.com/itm/123456789012' };
    expect(readOrderEmail(m)).toMatchObject({
      store: 'eBay',
      orderNumber: '01-23456-78901',
      items: [{ title: 'Chrono Trigger (Nintendo DS, 2008) Complete CIB Tested', priceCents: 2150, quantity: 1 }],
      taxCents: 160,
      shippingCents: 500,
      totalCents: 2810,
      link: 'https://www.ebay.com/itm/123456789012',
    });
    // Its suggestions' prices aren't other items of the order (they'd take a share of its tax and shipping).
    expect(readOrderEmail(m, 'Chrono Trigger')!.items).toEqual([{ title: 'Chrono Trigger (Nintendo DS, 2008) Complete CIB Tested', priceCents: 2150, quantity: 1 }]);
    expect(purchaseSubject(m.subject, PURCHASE_SUBJECTS_DEFAULT, NOT_PURCHASE_SUBJECTS_DEFAULT)).toBe(true);
  });

  it("reads Mercari's labels and amounts in two columns, and its listing by its ID", () => {
    const order = readOrderEmail(mail('You purchased: Okami HD Nintendo Switch Game', 'no-reply@alerts.us.mercari.com', MERCARI_2026), 'Okami HD')!;
    expect(order).toMatchObject({ store: 'Mercari', items: [{ title: 'Okami HD Nintendo Switch Game', priceCents: 3000, quantity: 1 }], taxCents: 240, totalCents: 3360, link: 'https://www.mercari.com/us/item/m12345678901/' });
    expect(readOrderEmail(mail('You purchased: Okami HD Nintendo Switch Game', 'no-reply@alerts.us.mercari.com', MERCARI_2026))!.items[0]!.priceCents).toBe(3000);
  });

  it("finds nothing in Amazon's confirmation that names only a department", () => {
    const m = mail('Ordered 1 item: Video Games', 'auto-confirm@amazon.com', AMAZON_2026);
    // Its order number has a writing direction's mark before it, taken out.
    expect(m.text).toContain('Order # 123-4567890-1234567');
    expect(readOrderEmail(m)).toBeNull();
    expect(readOrderEmail(m, 'Okami HD')).toBeNull();
  });

  it("reads GameStop's items, each with its count on a line between it and its price", () => {
    const m = mail('Thank you for your order!', 'notifications@info.gamestop.com', GAMESTOP_2026);
    const order = readOrderEmail(m)!;
    expect(order).toMatchObject({ store: 'GameStop', orderNumber: '1100000000000001', taxCents: 320, shippingCents: 0, discountCents: 1000, totalCents: 4320 });
    // "Call of Duty" is a game, not a duty.
    expect(order.items.map((i) => [i.title, i.priceCents, i.quantity])).toEqual([
      ['Okami HD - Nintendo Switch', 2000, 1],
      ['Call of Duty: World at War - Wii', 1200, 1],
      ['Ghost Trick: Phantom Detective - PlayStation 4', 1800, 1],
    ]);
    const ghost = readOrderEmail(m, 'Ghost Trick: Phantom Detective')!;
    expect(ghost.items.map((i) => i.priceCents)).toEqual([1800, 2000, 1200]);
    // 1800 of the 5000: its share of the tax and of the discount.
    expect(itemCost(ghost, 0, 'all')).toMatchObject({ taxCents: 115, discountCents: 360, paidCents: 1800 + 115 - 360 });
    // What goes to a model keeps the item after the two lines of the address.
    const forModel = orderTextForModel(m.text);
    expect(forModel).toContain('Okami HD - Nintendo Switch');
    expect(forModel).not.toMatch(/EXAMPLE WAY|SPRINGFIELD/);
  });

  it("reads Limited Run Games' older emails: an item's properties left out, its taxes added up, not its footer's repeat", () => {
    const m = mail('Limited Run Games - Order #1234567 Confirmed', 'orders@limitedrungames.com', LRG_2023);
    const plain = readOrderEmail(m)!;
    expect(plain).toMatchObject({ store: 'Limited Run Games', orderNumber: '1234567', items: [{ title: 'Switch Limited Run #88: River City Girls', priceCents: 3499, quantity: 1 }], taxCents: 213, shippingCents: 600, totalCents: 4312 });
    // A release's number isn't a sequel's ("#88").
    expect(readOrderEmail(m, 'River City Girls')!.items).toEqual([{ title: 'Switch Limited Run #88: River City Girls', priceCents: 3499, quantity: 1 }]);
    expect(purchaseSubject(m.subject, PURCHASE_SUBJECTS_DEFAULT, NOT_PURCHASE_SUBJECTS_DEFAULT)).toBe(true);
    const forModel = orderTextForModel(m.text);
    expect(forModel).not.toMatch(/Pat Example|Example Way|Springfield|5550000000/);
    expect(forModel).toContain('Copyright © 2023');
  });

  it("reads a Shopify store's newer emails: past an item's console and its ship date, from Shopify's own address", () => {
    const m = { ...mail('Limited Run Games - Order #7654321 Confirmed', 'store+00000@t.shopifyemail.com', LRG_2025), fromName: 'Limited Run Games' };
    const order = readOrderEmail(m)!;
    expect(order).toMatchObject({ store: 'Limited Run Games', items: [{ title: 'Blaster Master Zero Trilogy (Switch, PS5)', priceCents: 2999, quantity: 1 }], taxCents: 183, shippingCents: 700, totalCents: 3882 });
    expect(readOrderEmail(m, 'Blaster Master Zero Trilogy')!.items).toEqual([{ title: 'Blaster Master Zero Trilogy (Switch, PS5)', priceCents: 2999, quantity: 1 }]);
  });

  it("reads Super Rare Games': its price on a line of its own, duties as a tax, a total in pounds", () => {
    const m = mail('Order #100001 confirmed', 'help@superraregames.com', SRG_2026);
    const order = readOrderEmail(m, 'Lone Ruin')!;
    expect(order).toMatchObject({ store: 'Super Rare Games', orderNumber: '100001', currency: 'GBP', items: [{ title: '[CLUB] PB#12: Lone Ruin, Game #120 (Switch) - Exclusive Slipcover!', priceCents: 4000, quantity: 1 }], taxCents: 400, shippingCents: 999, totalCents: 5399 });
    expect(readOrderEmail(m)!.items).toEqual(order.items);
    expect(purchaseSubject(m.subject, PURCHASE_SUBJECTS_DEFAULT, NOT_PURCHASE_SUBJECTS_DEFAULT)).toBe(true);
    // A listing's year isn't a sequel's number either.
    expect(orderItemScore('Okami PS2 2006 CIB Complete', 'Okami')).toBe(1);
  });
});

describe('Find my stores', () => {
  it("names a sender's store by its web domain", () => {
    expect(senderDomain('notifications@info.gamestop.com')).toBe('gamestop.com');
    expect(senderDomain('ebay@reply.ebay.com')).toBe('ebay.com');
    expect(senderDomain('auto-confirm@amazon.co.uk')).toBe('amazon.co.uk');
    expect(senderDomain('help@superraregames.com')).toBe('superraregames.com');
    expect(senderDomain('not an address')).toBeNull();
  });

  it('searches Gmail for a purchase word in the subject, within the days', () => {
    expect(gmailPurchaseSearch(['order confirmed', 'receipt'], 365)).toBe('{subject:"order confirmed" subject:receipt} newer_than:365d');
  });

  it('lists the stores of purchase emails: the ones Squirrelcade reads first, then the most emails', () => {
    const yes = ['order confirmed', 'receipt', 'purchased', 'thank you for your order'];
    const no = ['shipped', 'delivered'];
    const at = (d: number) => new Date(Date.UTC(2026, 9, d)).toISOString();
    const stores = storesSeen(
      [
        { from: 'receipts@pizza.example', fromName: 'Pizza Place', subject: 'Your receipt from Pizza Place', date: at(1) },
        { from: 'receipts@pizza.example', fromName: 'Pizza Place', subject: 'Your receipt from Pizza Place', date: at(5) },
        { from: 'notifications@info.gamestop.com', fromName: 'GameStop', subject: 'Thank you for your order!', date: at(3) },
        { from: 'ebay@ebay.com', fromName: 'eBay', subject: 'Order confirmed: Okami PS2', date: at(2) },
        { from: 'ebay@ebay.com', fromName: 'eBay', subject: 'Your order has shipped: Okami PS2', date: at(4) },
        { from: 'news@shop.example', fromName: 'Shop', subject: 'New arrivals this week', date: at(6) },
      ],
      yes,
      no,
    );
    expect(stores).toEqual([
      { domain: 'ebay.com', name: 'eBay', emails: 1, lastSubject: 'Order confirmed: Okami PS2', lastDate: at(2), known: true },
      { domain: 'gamestop.com', name: 'GameStop', emails: 1, lastSubject: 'Thank you for your order!', lastDate: at(3), known: true },
      { domain: 'pizza.example', name: 'Pizza Place', emails: 2, lastSubject: 'Your receipt from Pizza Place', lastDate: at(5), known: false },
    ]);
  });
});
