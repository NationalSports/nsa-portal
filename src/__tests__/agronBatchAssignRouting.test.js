import fs from 'fs';
import path from 'path';

test('batch dashboard routes Agron through resolved planning instead of quick legacy assignment', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
  const routeStart = source.indexOf("if(bot_payload.target==='adidas_click'||isAgronCartPayload(bot_payload))");
  expect(routeStart).toBeGreaterThan(0);
  const routing = source.slice(routeStart, routeStart + 900);

  expect(routing).toContain('setTodoModal({open:true');
  expect(routing).toContain('}else{');
  expect(routing).toContain('assignBotTask({title,description,priority:1,bot_payload})');

  const saveStart = source.indexOf('if(isAgronCartPayload(_bp))');
  expect(saveStart).toBeGreaterThan(0);
  const saving = source.slice(saveStart, saveStart + 1300);
  expect(saving).toContain('buildAgronCartTask');
  expect(saving).toContain("issue.code==='po_line_missing'");
  expect(saving).toContain("issue.code==='po_line_ambiguous'");
  expect(saving).toContain("issue.code==='po_vendor_mismatch'");
  expect(saving).toContain('newTodo.bot_payload=_agronPayload');
  expect(source).toContain('this Agron batch contains more than one ship-to destination');
  expect(source).toContain('Agron tasks must be reviewed in the assignment window');
});

test('legacy Mac Mini worker leaves vendor_cart_v1 for its external runner', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', '..', 'bot-worker', 'worker.js'), 'utf8');
  expect(worker).toContain("const HANDLED_TASK_TYPES = new Set(['add_to_cart'])");
  expect(worker).toContain('vendor_cart_v1');
  expect(worker).toContain('if (tt && !HANDLED_TASK_TYPES.has(tt)) return false');
});
