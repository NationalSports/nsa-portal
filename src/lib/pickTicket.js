export const buildQrSheetInfoBoxes = ({ title, subtitle, rep, shipBadge } = {}) => {
  const boxes = [];
  if (title) boxes.push({ label: 'Customer / Team', value: title, sub: subtitle || '' });
  if (rep) boxes.push({ label: 'Rep', value: rep });
  if (shipBadge?.text) boxes.push({ label: 'Ship To', value: shipBadge.text });
  else boxes.push({ label: 'Fulfillment', value: 'In-House Deco' });
  return boxes;
};
