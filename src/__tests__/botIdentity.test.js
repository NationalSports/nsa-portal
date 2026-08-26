import fs from 'fs';
import path from 'path';
import {
  BOT_DISPLAY_NAME,
  BOT_MEMBER_ID,
  BOT_OWNER_EMAIL,
  BOT_OWNER_ID,
  BOT_TEAM_MEMBER_NAME,
  botTeamMemberName,
  botCompleteNeedsConfirm,
  buildBotCartPayload,
  canBotAddToCart,
  findOrderingBot,
  isBotOwner,
} from '../lib/botTasks';

describe('ordering bot identity and safety contract', () => {
  test('keeps the existing queue key while exposing the Chief of Staff identity', () => {
    expect(BOT_MEMBER_ID).toBe('bot-claude');
    expect(BOT_DISPLAY_NAME).toBe('Chief of Staff');
    expect(BOT_TEAM_MEMBER_NAME).toBe('Chief of Staff (Grok Bot)');
    expect(botTeamMemberName({ id: BOT_MEMBER_ID, name: 'Claude (Bot)' })).toBe(BOT_TEAM_MEMBER_NAME);
    expect(findOrderingBot([
      { id: 'bot-other', name: 'Other Bot', role: 'bot' },
      { id: BOT_MEMBER_ID, name: 'Claude (Bot)', role: 'bot' },
    ])?.id).toBe(BOT_MEMBER_ID);
  });

  test('keeps the Steve-only owner gate', () => {
    expect(isBotOwner({ id: BOT_OWNER_ID, email: 'other@example.com' })).toBe(true);
    expect(isBotOwner({ id: 'other', email: BOT_OWNER_EMAIL.toUpperCase() })).toBe(true);
    expect(isBotOwner({ id: 'other', email: 'csr@example.com' })).toBe(false);
  });

  test('queues add_to_cart work with the human review gate intact', () => {
    const task = buildBotCartPayload({
      poNumber: 'NSA 123',
      vendorName: 'Adidas',
      batches: [{
        id: 'batch-1',
        po_id: 'NSA 123',
        so_id: 'SO-1',
        items: [{ sku: 'ABC123', color: 'Black', qty: 2, sizes: { M: 2 } }],
      }],
      soId: 'SO-1',
    });

    expect(task.bot_payload.task_type).toBe('add_to_cart');
    expect(task.bot_payload.target).toBe('adidas_click');
    expect(task.description).toContain('STOP before submitting');
    expect(task.description).toContain('needs_review');
    expect(botCompleteNeedsConfirm({ bot_status: 'queued' })).toBeTruthy();
    expect(botCompleteNeedsConfirm({ bot_status: 'needs_review' })).toBeNull();
  });

  test('only advertises the credentialed Adidas CLICK cart flow', () => {
    expect(canBotAddToCart('Adidas')).toBe(true);
    expect(canBotAddToCart('SanMar')).toBe(false);
    expect(canBotAddToCart('Silver Screen')).toBe(false);
    expect(canBotAddToCart('Agron')).toBe(false);
    expect(canBotAddToCart('Momentec')).toBe(false);
    expect(canBotAddToCart('S&S Activewear')).toBe(false);
  });

  test('keeps mobile assignment owner-gated and explicitly Adidas-only', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
    const mobile = fs.readFileSync(path.join(__dirname, '..', 'MobilePortal.js'), 'utf8');
    expect(app).toContain('onAssignBot={isBotOwner(cu)?assignBotTask:null}');
    expect(app).toContain("if(!_bp.task_type){_bp.task_type='add_to_cart';_bp.target='adidas_click';_bp.vendor_name='Adidas'}");
    expect(app).toContain("_tbp.task_type==='add_to_cart'&&canBotAddToCart(_tbp.vendor_name||_tbp.target)");
    expect(mobile).toContain("bot_payload:{task_type:'add_to_cart',target:'adidas_click',vendor_name:'Adidas'}");
    expect(mobile).toContain('Assign Adidas cart');
  });
});
