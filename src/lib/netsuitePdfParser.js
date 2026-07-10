/* eslint-disable */
// ═══════════════════════════════════════════════════════════════════════
// NETSUITE PDF PARSER — extracted from src/App.js so it can be unit-tested
// (same decomposition move as lib/dbEngine.js).
//
// Parses the tab-separated text that extractPdfText produces from NSA
// NetSuite Sales Order / Estimate / PO / Invoice PDFs into structured
// documents: doc number, customer, totals, and line items with a size grid.
//
// Upgrades over the original App.js version (2026-07-10):
//  • Adidas inseam-variant size labels — `IS1111-S 7"` / `IS1111-XL7"` are
//    the same product as IS1111, just the 7-inch inseam. The trailing
//    `N"` token is stripped from SKU and description before size
//    detection, so these collapse into the base SKU's size grid.
//  • Half shoe sizes in the catalog's dash form — `KJ3537-9-` is size
//    "9-" (9.5). Previously the trailing dash broke size detection and
//    each row imported as a separate junk-SKU item.
//  • Tall sizes — LT / XLT / 2XLT / 3XLT / 4XLT / 5XLT parse as sizes
//    (e.g. `JX4452-LT`).
//  • Embedded size runs accept XXL/XXXL and normalize them to 2XL/3XL
//    ("8/S, 30/M, 6/XXL").
// ═══════════════════════════════════════════════════════════════════════

const rQ = v => Math.round(v * 4) / 4;

// One alternation for every size token we recognize at the end of a SKU or
// description: letter sizes, youth, tall, OSFA, numerics ("38"), shoe
// decimals ("9.5") and shoe half-size dash form ("9-").
const SZ_TOKEN = 'XXS|XS|YXS|YS|YM|YL|YXL|S|M|L|XL|2XL|3XL|4XL|5XL|LT|XLT|2XLT|3XLT|4XLT|5XLT|OSFA|\\d{1,2}(?:\\.\\d)?-?';
// Adidas inseam/length variant appended to a size label: `S 7"`, `XL7"`, `M 9"`.
// The base style is the same product — we don't list the inseam variant — so
// the token is dropped from SKU and description before size detection.
const INSEAM_RE = /\s*\d{1,2}(?:\.\d)?\s*["”]$/;

const parseNetSuitePdf = (text, docType, products) => {
  const result = { docNumber: '', date: '', customerName: '', terms: '', memo: '', subtotal: 0, tax: 0, shipping: 0, total: 0, lineItems: [], rawText: text, confidence: 'low', warnings: [] };
  const _products = products || [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const SZ_RE = new RegExp('[-\\s](' + SZ_TOKEN + ')$', 'i');

  // ── Extract document number ──
  const docPatterns = [
    /(?:Estimate|EST)[#\s:]*#?(EST-?\d+)/i,
    /(?:Sales Order|SO)[#\s:]*#?(SO-?\d+)/i,
    /(?:Purchase Order|PO)[#\s:]*#?(PO-?\d+)/i,
    /(?:Invoice|INV)[#\s:]*#?(INV-?\d+)/i,
    /#(EST\d+)/i, /#(SO-?\d+)/i, /#(PO-?\d+)/i, /#(INV-?\d+)/i,
    /(?:Estimate|Sales Order|Invoice|Purchase Order)\s*(?:#|No\.?|Number)\s*:?\s*(\d+)/i,
    /(?:Estimate|Sales Order|Invoice|Purchase Order)\s*#?\s*(\d{3,})/i,
    /(?:Document|Transaction|Order)\s*(?:#|No\.?|Number)\s*:?\s*(\d+)/i
  ];
  // For tab-separated text, also try extracting from lines like "Estimate #\t1234"
  for (const pat of docPatterns) { const m = text.match(pat); if (m) { result.docNumber = m[1]; break } }
  if (!result.docNumber) {
    for (const line of lines) {
      const tabMatch = line.match(/^(?:Estimate|Sales Order|Invoice|Purchase Order)\s*(?:#|No\.?|Number)\s*:?\t+(\d+)/i)
        || line.match(/^(?:Estimate|Sales Order|Invoice|Purchase Order)\s*#\s*\t+(\S+)/i);
      if (tabMatch) { result.docNumber = tabMatch[1]; break }
    }
  }

  // ── Extract date ──
  const dateMatch = text.match(/(?:Date|Ordered|Created|Invoice Date|Transaction Date)[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)
    || text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (dateMatch) result.date = dateMatch[1];

  // ── Extract terms ──
  const termsMatch = text.match(/(?:Terms|Payment Terms)[:\s]*([^\n\t]+)/i);
  if (termsMatch) result.terms = termsMatch[1].trim();

  // ── Extract memo ──
  for (const line of lines) {
    const memoMatch = line.match(/^Memo[:\s]*\t+(.*)/i) || line.match(/^Memo[:\s]+(.+)/i);
    if (memoMatch) { const mv = memoMatch[1].trim(); if (mv && !/^(Terms|Date|Item|Quantity)/i.test(mv)) { result.memo = mv; break } }
  }

  // ── Extract customer/Bill To ──
  let custFound = false;
  for (let i = 0; i < lines.length && !custFound; i++) {
    if (/^(Bill\s*To|Sold\s*To|Customer|Ship\s*To)\b/i.test(lines[i])) {
      const nameLines = [];
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const l = lines[j];
        if (/^(Ship\s*To|Date|Terms|Item|Quantity|Due|PO\s*#|Rep|Memo)/i.test(l)) break;
        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(l)) break;
        if (l.length < 2) break;
        nameLines.push(l);
      }
      if (nameLines.length > 0) {
        result.customerName = nameLines[0].replace(/\t.*/, '').trim();
        custFound = true;
      }
    }
  }

  // ── Extract totals ──
  // Look for totals that appear after the items section (tab-separated label + value)
  const pN = s => { const m = s.match(/\$?\s*([\d,]+\.?\d*)/); return m ? parseFloat(m[1].replace(/,/g, '')) : 0 };
  const pNfromLine = line => {
    // Extract the last dollar amount from a line (handles tab-separated totals)
    const parts = line.split('\t');
    for (let k = parts.length - 1; k >= 0; k--) {
      const v = parts[k].trim().replace(/[$,]/g, '');
      if (/^\d+\.?\d*$/.test(v) && parseFloat(v) > 0) return parseFloat(v);
    }
    return pN(line);
  };
  for (const line of lines) {
    const lt = line.replace(/\t.*/, '').trim();// first cell only for label matching
    if (/^Subtotal$/i.test(lt)) result.subtotal = pNfromLine(line);
    else if (/^Tax\b/i.test(lt)) result.tax = pNfromLine(line);
    else if (/^Shipping$/i.test(lt)) result.shipping = pNfromLine(line);
    else if (/^Total$/i.test(lt)) result.total = pNfromLine(line);
  }

  // ── Parse line items ──
  // NSA NetSuite PDFs: 2-line format per item
  // Line 1: Quantity \t Item (SKU : SKU-SIZE) \t [Options] \t Tax(Yes/No) \t Rate \t Amount
  // Line 2: Description (product name - Color - Size)
  // Detect header row
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if ((l.includes('quantity') || l.includes('qty')) && (l.includes('item') || l.includes('sku') || l.includes('description')) && (l.includes('amount') || l.includes('rate') || l.includes('price') || l.includes('extension'))) {
      headerIdx = i; break;
    }
  }

  const isEndMarker = l => { const t = l.replace(/\t.*/, '').trim(); return /^(Subtotal|Total$|Tax\b|Discount|Thank you|Comments|Notes$|Memo$|Terms$|Merchandise\s*Total|Document\s*Total|Report\s*Problems)/i.test(t) };
  const isMetadataLine = l => { const lo = l.toLowerCase(); return /\b(weight\s*\(lb\)|shipment\s*method|ship\s*date|terms\s*of\s*(payment|delivery)|document\s*(number|date)|rqst\s*ship\s*date)/i.test(lo) };
  // Detect page breaks and repeated headers from multi-page PDFs (skip, don't end)
  const isPageBreak = l => { const t = l.replace(/\t.*/, '').trim(); if (/^Page\s+\d/i.test(t)) return true; const flat = l.trim().replace(/\s+/g, ' '); return /^\d+\s+of\s+\d+$/i.test(flat) };
  const isRepeatedHeader = l => { const lo = l.toLowerCase(); return (lo.includes('quantity') || lo.includes('qty')) && (lo.includes('item') || lo.includes('sku') || lo.includes('description')) && (lo.includes('amount') || lo.includes('rate') || lo.includes('price') || lo.includes('extension')) };
  // Check if a line starts with a quantity number (item data line vs description line)
  const isItemLine = line => {
    const p = line.split('\t')[0]?.trim();
    return /^\d+$/.test(p);
  };

  // Collect 2-line item pairs from after the header
  const itemPairs = [];// [{dataLine, descLine}]
  if (headerIdx >= 0) {
    let i = headerIdx + 1;
    while (i < lines.length) {
      const line = lines[i];
      if (isEndMarker(line)) break;
      if (!line.trim() || isPageBreak(line) || isRepeatedHeader(line) || isMetadataLine(line)) { i++; continue }

      if (isItemLine(line)) {
        // This is a data line (qty/sku/rate/amount). Collect description from all
        // non-item lines that follow (shoes often split sizes across multiple lines).
        const descLines = [];
        let nextIdx = i + 1;
        while (nextIdx < lines.length) {
          const nl = lines[nextIdx];
          if (isPageBreak(nl) || isRepeatedHeader(nl) || !nl.trim()) { nextIdx++; continue }
          if (isItemLine(nl) || isEndMarker(nl) || isMetadataLine(nl)) break;
          descLines.push(nl);
          nextIdx++;
        }
        i = descLines.length > 0 ? nextIdx : i + 1;
        itemPairs.push({ dataLine: line, descLine: descLines.join(' ') });
      } else {
        // Standalone description line (continuation or orphan) — append
        if (itemPairs.length > 0) {
          const last = itemPairs[itemPairs.length - 1];
          last.descLine = last.descLine ? last.descLine + ' ' + line : line;
        }
        i++;
      }
    }
  } else {
    // No header — try scanning for qty-starting lines
    result.warnings.push('Could not detect item table header — trying pattern-based parsing');
    for (let i = 0; i < lines.length; i++) {
      if (isEndMarker(lines[i]) || isPageBreak(lines[i]) || isRepeatedHeader(lines[i]) || isMetadataLine(lines[i])) continue;
      if (isItemLine(lines[i])) {
        let descLine = '';
        if (i + 1 < lines.length && !isItemLine(lines[i + 1]) && !isEndMarker(lines[i + 1])) {
          descLine = lines[i + 1]; i++;
        }
        itemPairs.push({ dataLine: lines[i] || lines[i - 1], descLine });
      }
    }
  }

  // Parse each item pair
  const sizeItems = {};// keyed by baseSku+color+group for collapsing sizes
  // Decoration lines (Screen/Embroidery/etc) act as group boundaries on the
  // source order — items above each decoration share that decoration, so the
  // same SKU appearing again below a decoration is a separate group and must
  // not be merged. groupIndex is bumped on the next size item AFTER a
  // decoration line, so consecutive decorations stay in the same group.
  let groupIndex = 0;
  let pendingNewGroup = false;
  itemPairs.forEach(({ dataLine, descLine }) => {
    const parts = dataLine.split('\t').map(s => s.trim());
    const qty = parseInt(parts[0]) || 0;
    const skuRaw = parts[1] || '';
    // Extract rate and amount: scan from the end for numbers
    let rate = 0, amount = 0;
    const nums = [];
    for (let k = parts.length - 1; k >= 2; k--) {
      const v = parts[k].replace(/[$,]/g, '').trim();
      if (/^\d+\.?\d*$/.test(v)) nums.unshift(parseFloat(v));
      else if (nums.length >= 2) break;// stop once we have rate+amount
    }
    if (nums.length >= 2) { rate = nums[nums.length - 2]; amount = nums[nums.length - 1] }
    else if (nums.length === 1) { amount = nums[0]; rate = qty > 0 ? rQ(nums[0] / qty) : 0 }

    // Parse SKU — handles "JP4674 : JP4674-S" and "Screen 1"
    const skuColonParts = skuRaw.split(/\s*:\s*/);
    let baseSku = (skuColonParts[0] || skuRaw).trim();
    let fullSku = (skuColonParts[1] || baseSku).trim();

    // Drop the Adidas inseam-variant token ("IS1111-S 7\"" / "IS1111-XL7\"" → "IS1111-S"/"IS1111-XL")
    // BEFORE size detection — the inseam version isn't listed as its own product.
    baseSku = baseSku.replace(INSEAM_RE, '').trim();
    fullSku = fullSku.replace(INSEAM_RE, '').trim();

    // Fallback: if baseSku doesn't look like a product SKU, scan all parts for alphanumeric SKU (2 letters + 4 digits, e.g. EK0086)
    const ALPHA_SKU_RE = /\b([A-Za-z]{2}\d{4})\b/;
    if (baseSku && !/^[A-Za-z]{2}\d{4}/.test(baseSku) && !_products.some(p => p.sku.toLowerCase() === baseSku.toLowerCase())) {
      for (let pi = 0; pi < parts.length; pi++) { const am = parts[pi].match(ALPHA_SKU_RE); if (am) { baseSku = am[1].toUpperCase(); fullSku = baseSku; break } }
      // Also check description line for SKU
      if (!/^[A-Za-z]{2}\d{4}/.test(baseSku) && descLine) { const dm = descLine.match(ALPHA_SKU_RE); if (dm) { baseSku = dm[1].toUpperCase(); fullSku = baseSku } }
    }

    // Detect size suffix from fullSku
    const sizeMatch = fullSku.match(SZ_RE);
    let size = null;
    if (sizeMatch) {
      size = sizeMatch[1].toUpperCase();
      baseSku = baseSku.replace(SZ_RE, '').replace(/-$/, '').trim();
    }
    if (!size) { const bsm = baseSku.match(SZ_RE); if (bsm) { size = bsm[1].toUpperCase(); baseSku = baseSku.replace(SZ_RE, '').replace(/-$/, '').trim() } }

    // Parse description line for product name and color
    // (inseam token stripped first so "… - S 7\"" ends in a recognizable size)
    const description = (descLine || '').replace(/\t.*/, '').trim().replace(INSEAM_RE, '').trim();
    let color = '';
    // NSA descriptions use both - and – (en-dash): "Adidas Creator Tee - Black - S" or "Pant – White Pins"
    const SIZE_WORDS = new RegExp('^(?:' + SZ_TOKEN + ')$', 'i');
    const colorSizeMatch = description.match(new RegExp('\\s*[-–—]\\s*([A-Za-z][A-Za-z\\s,\\/]+?)\\s*[-–—]\\s*(?:' + SZ_TOKEN + ')\\s*$', 'i'));
    if (colorSizeMatch) color = colorSizeMatch[1].trim();
    else {
      // Try: "Name – Color" or "Name – Color Variant" (no size at end)
      const colorOnly = description.match(/\s*[-–—]\s*([A-Za-z][A-Za-z\s,\/]+?)\s*$/);
      if (colorOnly && !SIZE_WORDS.test(colorOnly[1].trim()) && !/(?:color|print|press|emb|screen|knicker|regular)/i.test(colorOnly[1])) color = colorOnly[1].trim();
    }
    // Fallback: detect Color/Color patterns (e.g. "Black/White", "Power Red/White") embedded in description
    if (!color) {
      const COLOR_ALT = 'Black|White|Navy|Red|Royal|Grey|Gray|Blue|Green|Maroon|Purple|Orange|Yellow|Pink|Brown|Scarlet|Cardinal|Gold|Silver|Charcoal|Onix|Burgundy|Teal|Cream|Tan|Power Red|Team Navy|Dark Green|Light Blue|Carbon|Collegiate Navy|Collegiate Royal';
      // Pattern: "Description ColorA/ColorB - Size" or "Description ColorA/ColorB"
      const slashColorMatch = description.match(new RegExp('\\b((?:' + COLOR_ALT + ')\\s*\\/\\s*\\w+)', 'i'));
      if (slashColorMatch) color = slashColorMatch[1].trim();
      // Pattern: known color word at end after a space (no dash), e.g. "Hood Black/White"
      if (!color) { const kcm = description.replace(new RegExp('\\s*[-–—]\\s*(?:' + SZ_TOKEN + ')\\s*$', 'i'), '').match(new RegExp('\\s(' + COLOR_ALT + ')\\s*$', 'i')); if (kcm) color = kcm[1].trim() }
    }
    // Simplify compound colors: "Black/White" → "Black", "Power Red/Wh" → "Power Red"
    if (color && color.includes('/')) color = color.split('/')[0].trim();
    // Clean product name (strip color/variant suffix from description)
    let productName = description;
    if (color) { productName = description.replace(new RegExp('\\s*[-–—]\\s*' + color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$', 'i'), '').trim() }

    // Skip metadata lines mistakenly parsed as items (weight, shipment info from supplier header)
    const skipMeta = /^(weight\s*\(|shipment\s*method|ship\s*date|rqst\s*ship|terms\s*of\s*(payment|delivery)|document\s*(number|date))/i;
    if (skipMeta.test(baseSku) || skipMeta.test(description) || (skuRaw && skipMeta.test(skuRaw))) { return }
    // Detect shipping lines
    if (/^shipping$/i.test(baseSku) || /^shipping$/i.test(description)) {
      result.shipping += amount || rate; return;
    }

    // Detect decoration lines: "Screen 1", "Emb 1", "Emb-NSA", "Screen-Print-1", "DTF-Logo", etc.
    const isDecoration = /^(Screen|Embr?|Embroidery|DTF|Heat|Vinyl|Sublim|Deco)(\b|[-_\s])/i.test(baseSku)
      || /^(screen\s*print|embroid|dtf|heat\s*trans|vinyl\s*print|sublim)/i.test(description);
    if (isDecoration) {
      // Parse decoration type from description: "Screen Print 1 Color", "Embroidery up to 8000 stitches"
      let decoType = 'art';
      if (/screen\s*print/i.test(description)) decoType = 'screen_print';
      else if (/embroid/i.test(description)) decoType = 'embroidery';
      else if (/dtf|heat\s*trans/i.test(description)) decoType = 'dtf';
      // Count colors from description: "Screen Print 2 Color" → 2
      const colorCountMatch = description.match(/(\d+)\s*colou?r/i);
      const colors = colorCountMatch ? parseInt(colorCountMatch[1]) : 1;
      result.lineItems.push({
        sku: baseSku, description, quantity: qty, rate: rate || 0, amount: amount || 0,
        isDecoration: true, decoType, colors, sizes: {}, raw: dataLine
      });
      // Mark that the next size item starts a new group; consecutive decos
      // don't keep bumping (multiple decos can apply to the same item block).
      pendingNewGroup = true;
      return;
    }

    // Collapse sizes: same baseSku+color within the same group → one item
    if (size && baseSku && pendingNewGroup) { groupIndex++; pendingNewGroup = false }
    const collapseKey = baseSku + '||' + (color || '') + '||' + groupIndex;
    if (size && baseSku) {
      if (!sizeItems[collapseKey]) {
        sizeItems[collapseKey] = { sku: baseSku, description: productName, color, quantity: 0, rate, amount: 0, isDecoration: false, sizes: {}, raw: dataLine, _group: groupIndex };
      }
      sizeItems[collapseKey].sizes[size] = (sizeItems[collapseKey].sizes[size] || 0) + qty;
      sizeItems[collapseKey].quantity += qty;
      sizeItems[collapseKey].amount += amount;
      if (color && !sizeItems[collapseKey].color) sizeItems[collapseKey].color = color;
      if (productName && !sizeItems[collapseKey].description) sizeItems[collapseKey].description = productName;
    } else {
      // No size detected — single item or embedded sizes in description
      const sizes = {};
      // Check for letter sizes: "12/S, 14/M, 8/L" (XXL/XXXL normalize to 2XL/3XL)
      const embSizeRe = /(\d+)\s*\/\s*(XXS|XS|YXS|YS|YM|YL|YXL|S|M|L|XL|XXL|2XL|XXXL|3XL|4XL|5XL|LT|XLT|2XLT|3XLT)/gi;
      const EMB_NORM = { XXL: '2XL', XXXL: '3XL' };
      let embMatch; while ((embMatch = embSizeRe.exec(description))) { const key = EMB_NORM[embMatch[2].toUpperCase()] || embMatch[2].toUpperCase(); sizes[key] = (sizes[key] || 0) + parseInt(embMatch[1]) }
      // Check for numeric sizes: "1/38 – knickers 2/42" → {38:1, 42:2}
      // Also shoe sizes: "1/7.5, 5/8.5, 5/9, 10/10, 8/10.5" → {7.5:1, 8.5:5, 9:5, 10:10, 10.5:8}
      if (Object.keys(sizes).length === 0) {
        const numSizeRe = /(\d+)\s*\/\s*(\d{1,2}(?:\.\d)?)(?![\d.])/g;
        let nm; while ((nm = numSizeRe.exec(description))) sizes[nm[2]] = (sizes[nm[2]] || 0) + parseInt(nm[1]);
      }
      const sizesUnknown = Object.keys(sizes).length === 0;
      if (sizesUnknown) sizes['OSFA'] = qty;
      result.lineItems.push({ sku: baseSku || 'MISC', description: productName || description, color, quantity: qty, rate, amount, isDecoration: false, sizes, _sizesUnknown: sizesUnknown, raw: dataLine });
    }
  });

  // Fold any color-less entry into its colored sibling for the same baseSku
  // and group (handles cases where one row's color extraction failed due to
  // footer/header noise — but only within the same decoration group).
  const sizeItemsList = Object.values(sizeItems);
  const colored = {};
  sizeItemsList.forEach(it => { if (it.color) { const k = it.sku + '||' + it._group; colored[k] = colored[k] || it } });
  const merged = [];
  sizeItemsList.forEach(it => {
    const k = it.sku + '||' + it._group;
    if (!it.color && colored[k] && colored[k] !== it) {
      const target = colored[k];
      Object.entries(it.sizes).forEach(([sz, q]) => { target.sizes[sz] = (target.sizes[sz] || 0) + q });
      target.quantity += it.quantity;
      target.amount += it.amount;
      return;
    }
    merged.push(it);
  });
  // Add collapsed size items to lineItems
  merged.forEach(it => {
    if (it.quantity > 0 && it.rate === 0 && it.amount > 0) it.rate = rQ(it.amount / it.quantity);
    result.lineItems.push(it);
  });

  // ── Confidence scoring ──
  if (result.docNumber && result.customerName && result.lineItems.length > 0) result.confidence = 'high';
  else if ((result.docNumber || result.customerName) && result.lineItems.length > 0) result.confidence = 'medium';
  else {
    result.confidence = 'low';
    if (result.lineItems.length === 0) result.warnings.push('No line items detected. The PDF format may not be recognized — try the paste option instead.');
    else result.warnings.push('Missing document number or customer. Please verify the extracted data.');
  }
  return result;
};

// Split multi-invoice PDF into separate documents by document number
const parseNetSuitePdfMulti = (pages, docType, products) => {
  const DOC_RE = /(?:Estimate|EST)[#\s:]*#?(EST-?\d+)|(?:Sales Order|SO)[#\s:]*#?(SO-?\d+)|(?:Purchase Order|PO)[#\s:]*#?(PO-?\d+)|(?:Invoice|INV)[#\s:]*#?(INV-?\d+)|#(EST\d+)|#(SO-?\d+)|#(PO-?\d+)|#(INV-?\d+)|(?:Estimate|Sales Order|Invoice|Purchase Order)\s*#?\s*(\d{3,})/i;
  // Detect document number on each page
  const pageDocNums = pages.map(pt => { const m = pt.match(DOC_RE); return m ? (m.find((v, i) => i > 0 && v) || '') : '' });
  // Group pages by document number; pages without a doc number attach to the previous page's doc
  const groups = {}; const order = [];
  let currentDoc = '__unknown__';
  pageDocNums.forEach((dn, i) => {
    if (dn) currentDoc = dn;
    if (!groups[currentDoc]) { groups[currentDoc] = []; order.push(currentDoc) }
    groups[currentDoc].push(pages[i]);
  });
  // If only one group, just parse normally (single document)
  if (order.length <= 1) {
    const allText = pages.join('\n');
    return [parseNetSuitePdf(allText, docType, products)];
  }
  // Parse each group as a separate document
  return order.map(docNum => {
    const text = groups[docNum].join('\n');
    return parseNetSuitePdf(text, docType, products);
  });
};

export { parseNetSuitePdf, parseNetSuitePdfMulti };
