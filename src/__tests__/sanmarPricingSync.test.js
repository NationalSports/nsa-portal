const { _test } = require('../../netlify/functions/sanmar-pricing-sync');

describe('SanMar bulk pricing sync parsing', () => {
  test('retains color, size, and account-price priority from SOAP rows', () => {
    const xml = `
      <listResponse><catalogColor>Black</catalogColor><size>S</size><myPrice>17.87</myPrice><piecePrice>21.87</piecePrice></listResponse>
      <listResponse><catalogColor>Black</catalogColor><size>2XL</size><myPrice>18.87</myPrice><piecePrice>22.87</piecePrice></listResponse>
      <listResponse><catalogColor>True Navy</catalogColor><size>S</size><salePrice>19.61</salePrice><piecePrice>23.61</piecePrice></listResponse>`;
    expect(_test.parsePricingRows(xml)).toEqual([
      { color: 'Black', size: 'S', price: 17.87 },
      { color: 'Black', size: '2XL', price: 18.87 },
      { color: 'True Navy', size: 'S', price: 19.61 },
    ]);
  });
});
