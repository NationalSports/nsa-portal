import fs from 'fs';
import path from 'path';

test('batch dashboard routes adidas through the planning modal, not quick legacy assignment', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
  const start = source.indexOf("if(bot_payload.target==='adidas_click'||isAgronCartPayload(bot_payload))");
  expect(start).toBeGreaterThan(0);
  const routing = source.slice(start, start + 900);

  expect(routing).toContain('setTodoModal({open:true');
  expect(routing).toContain('bot_payload');
  expect(routing).toContain('}else{');
  expect(routing).toContain('assignBotTask({title,description,priority:1,bot_payload})');
});
