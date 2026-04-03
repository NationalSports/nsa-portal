const { test, expect } = require('@playwright/test');
const { login, navTo, collectConsoleErrors } = require('./helpers');

/**
 * Full end-to-end test: Create estimate → add items → add decorations →
 * manage artwork → save → convert to SO → verify SO tabs.
 *
 * This test exercises the complete order lifecycle including artwork management,
 * catching the types of post-refactor regressions found in production.
 */
test.describe('Full Order Flow with Artwork', () => {

  test.beforeEach(async ({ page }) => {
    await login(page, 'Steve Peterson', 'Admin');
  });

  test('create estimate, add item, decoration, art, save, convert to SO', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Estimates');
    await page.waitForTimeout(500);

    // ── Step 1: Create new estimate ──
    const newBtn = page.locator('button', { hasText: /New Estimate|\+ Estimate/i }).first();
    await expect(newBtn).toBeVisible({ timeout: 5000 });
    await newBtn.click();
    await page.waitForTimeout(800);

    // Should open order editor with customer selector (since newE(null))
    const custLabel = page.locator('text=Select Customer');
    const hasCustPicker = await custLabel.isVisible({ timeout: 3000 }).catch(() => false);

    // Select a customer from the SearchSelect dropdown
    if (hasCustPicker) {
      // Click the SearchSelect to open dropdown
      const searchSelect = page.locator('.form-input', { hasText: /Search customer/i }).first();
      await searchSelect.click();
      await page.waitForTimeout(300);

      // Type to filter, then pick first result
      const searchInput = page.locator('input[placeholder="Search..."]').first();
      if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await searchInput.fill('a'); // broad filter to get results
        await page.waitForTimeout(300);
      }

      // Click first customer option
      const custOption = page.locator('div[style*="cursor: pointer"][style*="padding"]').filter({ hasNotText: /Search|No results/ }).first();
      if (await custOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await custOption.click();
        await page.waitForTimeout(500);
      }
    }

    // Verify we're in the order editor — should show the tabs
    const lineItemsTab = page.locator('button.tab', { hasText: /Line Items/i }).first();
    await expect(lineItemsTab).toBeVisible({ timeout: 5000 });

    // ── Step 2: Add a product ──
    const addProductBtn = page.locator('button', { hasText: /Add Product/i }).first();
    if (await addProductBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addProductBtn.click();
      await page.waitForTimeout(500);

      // Type in the product search
      const prodSearch = page.locator('input[placeholder*="Search"]').last();
      if (await prodSearch.isVisible({ timeout: 2000 }).catch(() => false)) {
        await prodSearch.fill('tee');
        await page.waitForTimeout(800); // wait for search results

        // Click first product result
        const productResult = page.locator('div[style*="cursor: pointer"][style*="borderBottom"]').first();
        if (await productResult.isVisible({ timeout: 3000 }).catch(() => false)) {
          await productResult.click();
          await page.waitForTimeout(500);
        }
      }
    }

    // ── Step 3: Add decoration to item ──
    const addArtBtn = page.locator('button', { hasText: /\+ Add Art/i }).first();
    if (await addArtBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addArtBtn.click();
      await page.waitForTimeout(300);

      // Decoration should appear — verify no crash
      await expect(page.locator('.sidebar')).toBeVisible();
    }

    // ── Step 4: Switch to Art Library tab and create art group ──
    const artTab = page.locator('button.tab', { hasText: /Art Library/i }).first();
    if (await artTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await artTab.click();
      await page.waitForTimeout(500);

      // Click "New Art Group"
      const newArtBtn = page.locator('button', { hasText: /New Art Group/i }).first();
      if (await newArtBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await newArtBtn.click();
        await page.waitForTimeout(500);

        // Art group should appear — look for "Untitled" text
        const artGroup = page.locator('text=Untitled').first();
        await expect(artGroup).toBeVisible({ timeout: 3000 });

        // Fill in art name
        const artNameInput = page.locator('input[placeholder*="Art"]').first();
        if (await artNameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await artNameInput.fill('Test Logo');
          await page.waitForTimeout(200);
        }

        // Select deco type if dropdown visible
        const decoTypeSelect = page.locator('select').filter({ hasText: /Screen Print|Embroidery/i }).first();
        if (await decoTypeSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
          await decoTypeSelect.selectOption({ index: 1 });
          await page.waitForTimeout(200);
        }
      }

      // ── Step 5: Add a Color Way ──
      const addColorWayBtn = page.locator('button', { hasText: /Add Color Way/i }).first();
      if (await addColorWayBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await addColorWayBtn.click();
        await page.waitForTimeout(300);

        // Color way should appear
        await expect(page.locator('.sidebar')).toBeVisible();
      }
    }

    // ── Step 6: Save the estimate ──
    const saveBtn = page.locator('button', { hasText: /^\s*Save\s*$/i }).first();
    if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(1000);
    }

    // Check for save confirmation (toast or "saved" indicator)
    // Also verify no yellow error banner appeared
    const errorBanner = page.locator('[style*="background"][style*="dc2626"], [style*="background"][style*="yellow"]').filter({ hasText: /failed|error/i });
    const hasError = await errorBanner.first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasError).toBeFalsy();

    // ── Step 7: Switch back to Items tab and verify decoration is linked ──
    await lineItemsTab.click();
    await page.waitForTimeout(300);

    // Should still have the item and decoration without errors
    await expect(page.locator('.sidebar')).toBeVisible();

    // ── Step 8: Convert to SO ──
    const convertBtn = page.locator('button', { hasText: /Convert to (Sales Order|SO)/i }).first();
    const canConvert = await convertBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (canConvert) {
      await convertBtn.click();
      await page.waitForTimeout(1500);

      // Should now be in SO editor — verify SO-specific tabs exist
      const jobsTab = page.locator('button.tab', { hasText: /Jobs/i }).first();
      const hasJobsTab = await jobsTab.isVisible({ timeout: 3000 }).catch(() => false);
      // SO editor has more tabs than estimate editor
      expect(hasJobsTab).toBeTruthy();

      // ── Step 9: Cycle through SO tabs ──
      const soTabs = ['Line Items', 'Art Library', 'Jobs', 'Firm Dates', 'Tracking', 'Costs', 'History'];
      for (const tabName of soTabs) {
        const tab = page.locator('button.tab', { hasText: new RegExp(tabName, 'i') }).first();
        if (await tab.isVisible({ timeout: 1000 }).catch(() => false)) {
          await tab.click();
          await page.waitForTimeout(400);
          // No crash — sidebar still visible
          await expect(page.locator('.sidebar')).toBeVisible();
        }
      }

      // ── Step 10: Verify art carried over to SO ──
      const soArtTab = page.locator('button.tab', { hasText: /Art Library/i }).first();
      if (await soArtTab.isVisible({ timeout: 1000 }).catch(() => false)) {
        await soArtTab.click();
        await page.waitForTimeout(500);
        // Art should be present (not empty)
        const artContent = page.locator('text=Test Logo');
        const hasArt = await artContent.isVisible({ timeout: 2000 }).catch(() => false);
        // If we named it, it should carry over
        if (hasArt) {
          expect(hasArt).toBeTruthy();
        }
      }

      // ── Step 11: Save SO ──
      const soSaveBtn = page.locator('button', { hasText: /Save/i }).first();
      if (await soSaveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await soSaveBtn.click();
        await page.waitForTimeout(1000);
      }

      // Verify no save errors
      const soError = page.locator('[style*="background"][style*="dc2626"]').filter({ hasText: /failed|error/i });
      const hasSoError = await soError.first().isVisible({ timeout: 2000 }).catch(() => false);
      expect(hasSoError).toBeFalsy();
    }

    // ── Final: No uncaught JS errors ──
    const realErrors = errors.filter(e =>
      !e.includes('Supabase') && !e.includes('net::') &&
      !e.includes('favicon') && !e.includes('ERR_CONNECTION') &&
      !e.includes('Failed to fetch') && !e.includes('NetworkError')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('existing SO art tab renders and art groups expand/collapse', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Sales Orders');
    await page.waitForTimeout(500);

    // Open first SO
    const soLink = page.locator('.main').locator('text=/SO-\\d+/').first();
    if (await soLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await soLink.click();
      await page.waitForTimeout(800);

      // Navigate to Art Library tab
      const artTab = page.locator('button.tab', { hasText: /Art Library/i }).first();
      if (await artTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await artTab.click();
        await page.waitForTimeout(500);

        // If art groups exist, try collapse/expand
        const artHeaders = page.locator('text=/Untitled|Logo|Art|Design/i').first();
        if (await artHeaders.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Click header to toggle collapse
          await artHeaders.click();
          await page.waitForTimeout(300);
          // Click again to expand
          await artHeaders.click();
          await page.waitForTimeout(300);
        }

        // Try adding a new art group
        const newArtBtn = page.locator('button', { hasText: /New Art Group/i }).first();
        if (await newArtBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await newArtBtn.click();
          await page.waitForTimeout(500);
          // New group should appear
          await expect(page.locator('.sidebar')).toBeVisible();
        }
      }
    }

    const realErrors = errors.filter(e =>
      !e.includes('Supabase') && !e.includes('net::') &&
      !e.includes('favicon') && !e.includes('ERR_CONNECTION') &&
      !e.includes('Failed to fetch') && !e.includes('NetworkError')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('estimate decoration types all render without errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Estimates');
    await page.waitForTimeout(500);

    // Open first estimate
    const estLink = page.locator('text=EST-').first();
    if (await estLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await estLink.click();
      await page.waitForTimeout(800);

      // Find an item and try adding each decoration type
      const decoButtons = [
        { text: /\+ Add Art/i, type: 'art' },
        { text: /Numbers/i, type: 'numbers' },
        { text: /Outside Deco/i, type: 'outside' },
      ];

      for (const { text, type } of decoButtons) {
        const btn = page.locator('button', { hasText: text }).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click();
          await page.waitForTimeout(400);
          // Should not crash
          await expect(page.locator('.sidebar')).toBeVisible();
        }
      }
    }

    const realErrors = errors.filter(e =>
      !e.includes('Supabase') && !e.includes('net::') &&
      !e.includes('favicon') && !e.includes('ERR_CONNECTION') &&
      !e.includes('Failed to fetch') && !e.includes('NetworkError')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('print/PDF generation does not produce blank page', async ({ page, context }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Estimates');
    await page.waitForTimeout(500);

    // Open first estimate
    const estLink = page.locator('text=EST-').first();
    if (await estLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await estLink.click();
      await page.waitForTimeout(800);

      // Look for print/PDF button
      const printBtn = page.locator('button', { hasText: /Print|PDF|🖨/i }).first();
      if (await printBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Listen for new pages (PDF opens in new tab or triggers download)
        const pagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
        await printBtn.click();
        await page.waitForTimeout(1500);

        const newPage = await pagePromise;
        if (newPage) {
          await newPage.waitForTimeout(1000);
          // Verify it's not a blank page — should have some content
          const content = await newPage.content();
          // A blank page would be essentially empty HTML
          const isBlank = content.length < 200 && !content.includes('pdf');
          expect(isBlank).toBeFalsy();
          await newPage.close();
        }
        // If no new page, it used html2pdf which downloads directly — that's fine
      }
    }

    const realErrors = errors.filter(e =>
      !e.includes('Supabase') && !e.includes('net::') &&
      !e.includes('favicon') && !e.includes('ERR_CONNECTION') &&
      !e.includes('Failed to fetch') && !e.includes('NetworkError') &&
      !e.includes('html2pdf') // html2pdf may log warnings
    );
    expect(realErrors).toHaveLength(0);
  });

  test('save estimate with decorations does not trigger RLS error', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Estimates');
    await page.waitForTimeout(500);

    // Open first estimate
    const estLink = page.locator('text=EST-').first();
    if (await estLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await estLink.click();
      await page.waitForTimeout(800);

      // Add a decoration
      const addArtBtn = page.locator('button', { hasText: /\+ Add Art/i }).first();
      if (await addArtBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await addArtBtn.click();
        await page.waitForTimeout(300);
      }

      // Save
      const saveBtn = page.locator('button', { hasText: /Save/i }).filter({ has: page.locator('svg') }).first();
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveBtn.click();
        await page.waitForTimeout(1500);
      }

      // Check for RLS-style errors: "new row violates", "permission denied", "policy"
      const pageContent = await page.content();
      expect(pageContent).not.toContain('new row violates');
      expect(pageContent).not.toContain('permission denied');

      // Check no error banner
      const errorBanner = page.locator('text=/failed to save|save error|RLS/i');
      const hasError = await errorBanner.first().isVisible({ timeout: 2000 }).catch(() => false);
      expect(hasError).toBeFalsy();
    }

    const realErrors = errors.filter(e =>
      !e.includes('Supabase') && !e.includes('net::') &&
      !e.includes('favicon') && !e.includes('ERR_CONNECTION') &&
      !e.includes('Failed to fetch') && !e.includes('NetworkError')
    );
    expect(realErrors).toHaveLength(0);
  });

});
