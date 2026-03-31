/* eslint-disable */
// Safe accessor helpers — used throughout App.js, OrderEditor, CustDetail, etc.
export const safe = (v, def) => v != null ? v : def;
export const safeArr = (v) => Array.isArray(v) ? v : [];
export const safeObj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
export const safeNum = (v) => typeof v === 'number' && !isNaN(v) ? v : 0;
export const safeStr = (v) => typeof v === 'string' ? v : '';
export const safeSizes = (it) => safeObj(it?.sizes);
export const safePicks = (it) => safeArr(it?.pick_lines);
export const safePOs = (it) => safeArr(it?.po_lines);
export const safeDecos = (it) => safeArr(it?.decorations);
export const safeItems = (o) => safeArr(o?.items);
export const safeArt = (o) => safeArr(o?.art_files);
export const safeJobs = (o) => safeArr(o?.jobs);
export const safeFirm = (o) => safeArr(o?.firm_dates);
