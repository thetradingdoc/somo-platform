import { fetchBeautyFactsByBarcode } from './landingAssistantApi';

describe('fetchBeautyFactsByBarcode', () => {
  test('rejects invalid barcode client-side', async () => {
    await expect(fetchBeautyFactsByBarcode({ apiBase: 'http://localhost:4000', barcode: '12' }))
      .rejects
      .toThrow('Invalid barcode');
  });
});

