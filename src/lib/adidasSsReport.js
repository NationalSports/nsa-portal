// Display-only S&S -> adidas garment-tag references for reports.
//
// The ordering SKU stays untouched. An item sourced from S&S (AT310-50) may
// arrive with adidas' article on the physical tag (JL5410), so production
// reports show both. Direct adidas articles are intentionally never reverse-
// mapped to S&S: they already carry the only number the report needs.

const normalizedSku = (sku) => String(sku || '').trim().toUpperCase();
const normalizedColor = (color) => String(color || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function isSsAdidasOrderSku(sku) {
  return /^AT[0-9]+(?:-[A-Z0-9-]+)?$/i.test(String(sku || '').trim());
}

export function reportOrderSku(line) {
  if (!line) return '';
  if (line._unmatched) return line._effSku || line.sku || '';
  return line._sku || line._effSku || line.sku || '';
}

export function applyAdidasTagRows(lines, rows) {
  const articleBySsSku = {};
  const variantsByStyle = {};
  (rows || []).forEach((row) => {
    const ssSku = normalizedSku(row && row.ss_sku);
    const article = normalizedSku(row && row.adidas_article);
    if (ssSku && article && !articleBySsSku[ssSku]) articleBySsSku[ssSku] = article;
    const style = normalizedSku(row && row.style);
    if (style && article) (variantsByStyle[style] = variantsByStyle[style] || []).push(row);
  });
  return (lines || []).map((line) => {
    const orderSku = reportOrderSku(line);
    const normalizedOrderSku = normalizedSku(orderSku);
    let article = isSsAdidasOrderSku(orderSku) ? articleBySsSku[normalizedOrderSku] : '';
    // Some manually-added SO replacement lines carry the base S&S style only
    // (AT301 / AT310). Resolve the color-specific row before adding the Adidas
    // garment-tag article; never guess when multiple colorways still qualify.
    if (!article && /^AT[0-9]+$/i.test(normalizedOrderSku)) {
      const color = normalizedColor(line._color || line.color);
      const variants = variantsByStyle[normalizedOrderSku] || [];
      const matches = variants.filter((row) => {
        const ssColor = normalizedColor(row.ss_colour);
        const adidasColor = normalizedColor(row.adidas_colour);
        return color && (color === ssColor || color === adidasColor);
      });
      const chosen = matches.length === 1 ? matches[0] : (variants.length === 1 ? variants[0] : null);
      article = normalizedSku(chosen && chosen.adidas_article);
    }
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
    const exactSkus = skus.filter((sku) => sku.includes('-'));
    const baseStyles = skus.filter((sku) => !sku.includes('-'));
    for (let i = 0; i < exactSkus.length; i += 100) {
      const { data, error } = await supabase
        .from('adidas_ss_sku_xref')
        .select('style,ss_sku,ss_colour,adidas_article,adidas_colour,rank')
        .in('ss_sku', exactSkus.slice(i, i + 100))
        .eq('rank', 1);
      if (error) throw error;
      rows.push(...(data || []));
    }
    for (let i = 0; i < baseStyles.length; i += 100) {
      const { data, error } = await supabase
        .from('adidas_ss_sku_xref')
        .select('style,ss_sku,ss_colour,adidas_article,adidas_colour,rank')
        .in('style', baseStyles.slice(i, i + 100))
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
