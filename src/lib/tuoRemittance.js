// TUO **Store Remittance Report** parser.
//
// TUO settles a batch of orders and remits one amount to our bank. The report
// has a header, one row per store that contributed, a fee table, and a
// two-column summary box:
//
//   Store Remittance Report
//   Remittance/Invoice # 126388      Date Created 09/15/2026 21:00 pm PDT
//   Total Orders 26                  Item Quantity Total 180
//
//   Type   Store Name                              Billed    Free   Assessed
//   Club   Lake SC 2026/27 - U10 Molina U10        $275.00   $0.00  $275.00
//   Spirit Coronado FC(588)                      $2,105.50   $0.00  $2,105.50
//
//   Credit Card Fees     2.90%  $5,547.32  $160.87
//   Commission on Items  3.00%  $4,841.50  $145.25
//   Total Fees                             $306.12
//
//   Items Ordered  $4,841.50 | Total Collected on TUO CC Merchant Account $5,547.32
//   Sales Tax        $393.88 | TUO Fees                                     $145.25
//   ...                      | Remittance Amount                          $5,241.20
//
// HOW THIS DIFFERS FROM THE OMG DEPOSIT STATEMENT, and why the code is not
// shared with lib/omgDeposit.js:
//
//   1. There is NO store code. Stores carry a name and a type only, so rows
//      cannot be matched mechanically the way an OMG sale code can. Matching a
//      row to a customer is a decision a person makes once per store name; see
//      `suggestCustomers` and the tuo_store_map table.
//   2. Fees are charged at the STATEMENT level, not per store. The report gives
//      a gross assessed amount per store and nothing else, so there is no
//      per-store net deposit anywhere on the document. `allocateFees` can
//      estimate one pro-rata, but it is explicitly an estimate: it divides only
//      the fees, while the remitted amount also contains shipping and sales tax
//      that belong to no store row.
//
// The summary box is two columns and pdf.js groups text by vertical position,
// so one extracted line carries a label/value pair from each column. Every
// summary value is therefore read from just after its own label and cut off at
// whichever label starts next — never "the last number on the line".

const MONEY_TOKEN = /\(\s*\$\s?-?[\d,]+\.\d{2}\s*\)|\$\s?-?[\d,]+\.\d{2}/g;

// Every label that can start a cell in the header, fee table or summary box.
// Used as the right-hand boundary when reading a value out of a merged line.
const LABELS = new RegExp([
  'remittance\\s*/?\\s*invoice\\s*#?', 'date\\s*created', 'total\\s*orders',
  'item\\s*quantity\\s*total', 'credit\\s*card\\s*fees', 'commission\\s*on\\s*items',
  'total\\s*fees', 'items\\s*ordered', 'fundraiser\\s*tax', 'fundraisers',
  'shipping', 'bulk\\s*fee', 'handling', 'sales\\s*tax', 'store\\s*discounts',
  'total\\s*billed\\s*amount', 'total\\s*collected(?:\\s*on\\s*tuo.*?account)?',
  'cc\\s*fees', 'tuo\\s*fees', 'total\\s*re-?\\s*closed\\s*amount', 'remittance\\s*amount',
  'billed\\s*qty', 'free\\s*qty', 'total\\s*assessed', 'store\\s*name',
].join('|'), 'gi');

// Store types TUO prints in the first column. An unfamiliar one is reported
// rather than silently dropped — see `problems` in parseTuoRemittance.
const STORE_TYPES = ['Club', 'Spirit', 'Corporate', 'Fundraiser', 'School', 'Team'];

const roundMoney = value => Math.round((Number(value) || 0) * 100) / 100;

const parseMoney = token => {
  const raw = String(token == null ? '' : token);
  const negative = raw.trim().startsWith('(');
  const parsed = Number(raw.replace(/[($),\s]/g, ''));
  if (!Number.isFinite(parsed)) return 0;
  return roundMoney(negative ? -Math.abs(parsed) : parsed);
};

const moneyOn = line => (String(line || '').match(MONEY_TOKEN) || []).map(parseMoney);
const cleanLine = line => String(line == null ? '' : line).replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();

// The value following `labelRe` on its line, cut off where the next label begins.
const valueAfter = (line, labelRe) => {
  const flat = cleanLine(line);
  const match = flat.match(labelRe);
  if (!match) return null;
  const rest = flat.slice(match.index + match[0].length);
  LABELS.lastIndex = 0;
  let cut = rest.length;
  let next;
  while ((next = LABELS.exec(rest)) !== null) {
    if (next.index > 0) { cut = next.index; break; }
  }
  return rest.slice(0, cut).replace(/^[:\s]+/, '').trim();
};

const labelledAmount = (lines, labelRe) => {
  for (const line of lines) {
    const value = valueAfter(line, labelRe);
    if (value == null) continue;
    const amounts = moneyOn(value);
    if (amounts.length) return amounts[0];
  }
  return 0;
};

const labelledInt = (lines, labelRe) => {
  for (const line of lines) {
    const value = valueAfter(line, labelRe);
    if (value == null) continue;
    const nums = value.match(/\b\d+\b/g);
    if (nums && nums.length) return Number(nums[0]);
  }
  return 0;
};

const labelledText = (lines, labelRe) => {
  for (const line of lines) {
    const value = valueAfter(line, labelRe);
    if (value) return value;
  }
  return '';
};

// "09/15/2026 21:00 pm PDT" -> "2026-09-15". The time zone is dropped: the date
// is what reconciles against the bank, and TUO prints it in Pacific either way.
const parseRemittanceDate = raw => {
  const text = String(raw || '');
  const pad = v => String(v).padStart(2, '0');
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
  const us = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!us) return '';
  let year = Number(us[3]);
  if (year < 100) year += 2000;
  return `${year}-${pad(Number(us[1]))}-${pad(Number(us[2]))}`;
};

const isTuoRemittance = text => /store\s*remittance\s*report/i.test(String(text || ''));

// Summary and fee lines are excluded by LABEL, not just by how many amounts
// they carry, so a two-column merge can never be mistaken for a store row.
const SUMMARY_LINE = /items\s*ordered|total\s*fees|credit\s*card\s*fees|commission\s*on|remittance\s*amount|total\s*collected|total\s*billed|store\s*discounts|sales\s*tax|bulk\s*fee|fundraiser|total\s*re-?\s*closed|cc\s*fees|tuo\s*fees|billed\s*qty|total\s*assessed|handling/i;

// A store row: a leading type, a name, then billed / free / assessed.
const parseStoreRow = (line, lineNo) => {
  const flat = cleanLine(line);
  if (!flat || SUMMARY_LINE.test(flat)) return null;
  const amounts = moneyOn(flat);
  if (amounts.length < 3) return null;

  const firstMoneyAt = flat.search(MONEY_TOKEN);
  const labelPart = flat.slice(0, firstMoneyAt).trim();
  if (!labelPart) return null;

  const [billed, free, assessed] = amounts.slice(-3);
  const tokens = labelPart.split(/\s+/);
  const typeMatch = STORE_TYPES.find(t => t.toLowerCase() === (tokens[0] || '').toLowerCase());
  const storeType = typeMatch || '';
  const storeName = (typeMatch ? tokens.slice(1).join(' ') : labelPart).trim();

  const problems = [];
  if (!typeMatch) problems.push(`Unrecognised store type "${tokens[0] || ''}"`);
  if (!storeName) problems.push('Row has no store name');
  if (Math.abs(roundMoney(billed + free) - assessed) > 0.01) {
    problems.push('Billed + free does not equal assessed');
  }

  return { lineNo, storeType, storeName, billed, free, assessed, problems };
};

// Map key for the store -> customer decision. Deliberately the FULL printed
// name: two teams of one club are two stores, and they may belong on different
// customers.
const tuoStoreKey = name => cleanLine(name).toUpperCase();

// Loose form used only to *suggest* a customer. Strips the parts that vary
// between seasons and teams so "Vista HS Field Hockey 2026" can be lined up
// against the customer "Vista High School Field Hockey".
const matchForm = name => {
  let text = cleanLine(name).toUpperCase();
  text = text.replace(/\(\s*\d+\s*\)/g, ' ');              // "Coronado FC(588)"
  text = text.split(/\s+-\s+/)[0];                          // "… 2026/27 - U10 Molina U10"
  text = text.replace(/\b20\d{2}\s*\/\s*\d{2}\b/g, ' ');    // 2026/27
  text = text.replace(/\b20\d{2}\b/g, ' ');                 // 2026
  text = text.replace(/^THE\s+/, ' ');
  text = text.replace(/\bH\.?S\.?\b/g, 'HIGH SCHOOL');
  text = text.replace(/[^A-Z0-9 ]+/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
};

/**
 * Rank candidate customers for a TUO store name. At most `limit` entries, best
 * first, each { customer, score, exact }.
 *
 * An `exact` hit means the two names agree once season/team/punctuation noise
 * is stripped — strong enough to pre-select, still shown for confirmation. A
 * person confirms once per store name and the mapping is reused from then on,
 * so a wrong guess is corrected before it can ever touch money.
 */
const suggestCustomers = (storeName, customers = [], limit = 3) => {
  const target = matchForm(storeName);
  if (!target) return [];
  const targetTokens = new Set(target.split(' ').filter(Boolean));
  const scored = [];
  customers.forEach(customer => {
    const form = matchForm(customer?.name || '');
    if (!form) return;
    const exact = form === target;
    const tokens = form.split(' ').filter(Boolean);
    if (!tokens.length) return;
    let shared = 0;
    tokens.forEach(t => { if (targetTokens.has(t)) shared += 1; });
    if (!exact && !shared) return;
    // Overlap relative to both sides, so a short name does not win by brevity
    // and a long name that merely contains the target does not win by length.
    const score = exact ? 1 : (2 * shared) / (tokens.length + targetTokens.size);
    scored.push({ customer, score: Math.round(score * 1000) / 1000, exact });
  });
  scored.sort((a, b) => (Number(b.exact) - Number(a.exact)) || (b.score - a.score) ||
    String(a.customer.name).localeCompare(String(b.customer.name)));
  return scored.slice(0, limit);
};

/**
 * Pro-rata fee estimate per store row.
 *
 * NOT from the document: TUO charges fees on the statement, not the store. Each
 * row gets a share of total fees proportional to its assessed amount. The `net`
 * values therefore sum to (items ordered − total fees), NOT to the remitted
 * amount, which also carries shipping and sales tax attributed to no store.
 * Present it as an estimate or not at all.
 */
const allocateFees = (lines = [], totalFees = 0) => {
  const gross = roundMoney(lines.reduce((total, row) => total + (Number(row.assessed) || 0), 0));
  const fees = Math.abs(Number(totalFees) || 0);
  return lines.map(row => {
    const assessed = Number(row.assessed) || 0;
    const share = gross ? assessed / gross : 0;
    const estFees = roundMoney(share * fees);
    return { ...row, share: Math.round(share * 10000) / 10000, estFees, estNet: roundMoney(assessed - estFees) };
  });
};

const parseTuoRemittance = text => {
  const allLines = String(text || '').split('\n');
  const problems = [];
  if (!isTuoRemittance(text)) problems.push('This file is not a TUO Store Remittance Report');

  const remittanceNo = (labelledText(allLines, /remittance\s*\/?\s*invoice\s*#?\s*/i).match(/\d+/) || [''])[0];
  const dateCreated = parseRemittanceDate(labelledText(allLines, /date\s*created\s*/i));
  const totalOrders = labelledInt(allLines, /total\s*orders\b/i);
  const itemQtyTotal = labelledInt(allLines, /item\s*quantity\s*total\b/i);

  const itemsOrdered = labelledAmount(allLines, /items\s*ordered/i);
  const fundraiserTax = labelledAmount(allLines, /fundraiser\s*tax/i);
  const fundraisers = labelledAmount(allLines, /\bfundraisers\b/i);
  const shipping = labelledAmount(allLines, /\bshipping\b/i);
  const bulkFee = labelledAmount(allLines, /bulk\s*fee/i);
  const handling = labelledAmount(allLines, /\bhandling\b/i);
  const salesTax = labelledAmount(allLines, /sales\s*tax/i);
  const storeDiscounts = labelledAmount(allLines, /store\s*discounts/i);
  const totalBilled = labelledAmount(allLines, /total\s*billed\s*amount/i);
  const totalCollected = labelledAmount(allLines, /total\s*collected/i);
  const ccFees = labelledAmount(allLines, /\bcc\s*fees\b/i);
  const tuoFees = labelledAmount(allLines, /\btuo\s*fees\b/i);
  const totalReClosed = labelledAmount(allLines, /total\s*re-?\s*closed\s*amount/i);
  const remittanceAmount = labelledAmount(allLines, /remittance\s*amount/i);
  const printedTotalFees = labelledAmount(allLines, /total\s*fees/i);

  const lines = [];
  allLines.forEach((line, index) => {
    const row = parseStoreRow(line, index + 1);
    if (row) lines.push(row);
  });

  if (!remittanceNo) problems.push('Could not read the Remittance/Invoice #');
  if (!dateCreated) problems.push('Could not read the Date Created');
  if (!lines.length) problems.push('No store rows were found');

  // Cross-checks against the report's own arithmetic. The first is the one that
  // catches a store row the parser failed to recognise — a missed row cannot
  // hide, whatever its type column says.
  const rowTotal = roundMoney(lines.reduce((total, row) => total + row.assessed, 0));
  if (lines.length && itemsOrdered && Math.abs(rowTotal - itemsOrdered) > 0.01) {
    problems.push(`Store rows total ${rowTotal.toFixed(2)} but Items Ordered says ${itemsOrdered.toFixed(2)}`);
  }
  const feeSum = roundMoney(ccFees + tuoFees);
  if (printedTotalFees && Math.abs(feeSum - printedTotalFees) > 0.01) {
    problems.push(`CC fees + TUO fees = ${feeSum.toFixed(2)} but Total Fees says ${printedTotalFees.toFixed(2)}`);
  }
  const computedRemittance = roundMoney(totalCollected - ccFees - tuoFees);
  if (totalCollected && remittanceAmount && Math.abs(computedRemittance - remittanceAmount) > 0.01) {
    problems.push(`Collected − fees = ${computedRemittance.toFixed(2)} but Remittance Amount says ${remittanceAmount.toFixed(2)}`);
  }
  lines.filter(row => row.problems.length).forEach(row => {
    problems.push(`${row.storeName || `Row ${row.lineNo}`}: ${row.problems.join('; ')}`);
  });

  // TUO's own components do not always add to the cent (their rounding, not
  // ours — the 09/15/26 report is 6c out). Reported for the record; never a
  // reason to refuse the import.
  const componentSum = roundMoney(itemsOrdered + shipping + salesTax + fundraiserTax + fundraisers + bulkFee + handling - Math.abs(storeDiscounts));
  const collectedDrift = totalCollected ? roundMoney(componentSum - totalCollected) : 0;

  return {
    remittanceNo,
    // Natural key for idempotent re-import: TUO's own invoice number.
    remittanceKey: remittanceNo || (dateCreated ? `DATE-${dateCreated}` : ''),
    dateCreated,
    totalOrders,
    itemQtyTotal,
    itemsOrdered,
    fundraiserTax,
    fundraisers,
    shipping,
    bulkFee,
    handling,
    salesTax,
    storeDiscounts,
    totalBilled,
    totalCollected,
    ccFees,
    tuoFees,
    totalFees: printedTotalFees || feeSum,
    totalReClosed,
    remittanceAmount,
    collectedDrift,
    lines,
    problems,
  };
};

export {
  MONEY_TOKEN,
  STORE_TYPES,
  parseMoney,
  parseRemittanceDate,
  parseStoreRow,
  isTuoRemittance,
  parseTuoRemittance,
  tuoStoreKey,
  matchForm,
  suggestCustomers,
  allocateFees,
  roundMoney,
};
