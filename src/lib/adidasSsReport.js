// Display-only S&S -> adidas garment-tag references for reports.
//
// The ordering SKU stays untouched. An item sourced from S&S (AT310-50) may
// arrive with adidas' article on the physical tag (JL5410), so production
// reports show both. Direct adidas articles are intentionally never reverse-
// mapped to S&S: they already carry the only number the report needs.

const normalizedSku = (sku) => String(sku || '').trim().toUpperCase();

export function isSsAdidasOrderSku(sku) {
  return /^AT[0-9]+-[A-Z0-9-]+$/i.test(String(sku || '').trim());
}

export function reportOrderSku(line) {
  if (!line) return '';
  if (line._unmatched) return line._effSku || line.sku || '';
  return line._sku || line._effSku || line.sku || '';
}

export function applyAdidasTagRows(lines, rows) {
  const articleBySsSku = {};
  (rows || []).forEach((row) => {
    const ssSku = normalizedSku(row && row.ss_sku);
    const article = normalizedSku(row && row.adidas_article);
    if (ssSku && article && !articleBySsSku[ssSku]) articleBySsSku[ssSku] = article;
  });
  return (lines || []).map((line) => {
    const orderSku = reportOrderSku(line);
    const article = isSsAdidasOrderSku(orderSku) ? articleBySsSku[normalizedSku(orderSku)] : '';
    return article ? { ...line, _adidasTagSku: article } : line;
  });
}

// Fetch all report mappings in batches, never one query per line. Best-effort:
// the report still prints its real ordering SKUs if the reference view is
// temporarily unavailable, instead of blocking fulfillment paperwork.
export async function attachAdidasTagSkus(supabase, lines) {
  const skus = [...new Set((lines || [])
    .map(reportOrderSku)
    .filter(isSsAdidasOrderSku)
    .map(normalizedSku))];
  if (!supabase || !skus.length) return lines || [];

  const rows = [];
  try {
    for (let i = 0; i < skus.length; i += 100) {
      const { data, error } = await supabase
        .from('adidas_ss_sku_xref')
        .select('ss_sku,adidas_article,rank')
        .in('ss_sku', skus.slice(i, i + 100))
        .eq('rank', 1);
      if (error) throw error;
      rows.push(...(data || []));
    }
  } catch (error) {
    console.warn('Could not load S&S/adidas report references:', error && error.message ? error.message : error);
    return lines || [];
  }
  return applyAdidasTagRows(lines, rows);
}
