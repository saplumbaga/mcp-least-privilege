// Public demo credentials, deliberately unsuitable for production.
export const demoTokens = Object.freeze({
  alice: 'demo-alice-token',
  ben: 'demo-ben-token',
});

export const customers = Object.freeze({
  alice: Object.freeze({
    profile: Object.freeze({ name: 'Alice Morgan', email: 'alice@example.test' }),
    orders: Object.freeze([
      Object.freeze({ orderId: 'A-101', item: 'Notebook', status: 'delivered' }),
      Object.freeze({ orderId: 'A-102', item: 'Desk lamp', status: 'processing' }),
    ]),
  }),
  ben: Object.freeze({
    profile: Object.freeze({ name: 'Ben Carter', email: 'ben@example.test' }),
    orders: Object.freeze([
      Object.freeze({ orderId: 'B-201', item: 'Travel mug', status: 'shipped' }),
      Object.freeze({ orderId: 'B-202', item: 'Backpack', status: 'delivered' }),
    ]),
  }),
});
