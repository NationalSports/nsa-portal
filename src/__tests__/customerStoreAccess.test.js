const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('customer OMG store navigation access', () => {
  test('only offers the deep link when the current user can access OMG Stores', () => {
    const app = read('App.js');
    const customer = read('CustDetail.js');

    expect(app).toMatch(/onOpenOmgStore=\{canAccess\('omg'\)\?/);
    expect(customer).toContain('OMG access required');
    expect(customer).toContain('Ask an admin to enable OMG Stores in Team Access');
  });
});
