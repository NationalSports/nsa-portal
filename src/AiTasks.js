/* eslint-disable */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './components';

const OPEN_BOT = new Set(['queued', 'scheduled', 'in_progress', 'needs_input', 'needs_review']);
const OPEN_REQUEST = new Set(['processing', 'needs_review']);
const fmtDate = value => {
  const d = new Date(value || 0);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const statusTheme = status => {
  if (['done', 'completed', 'draft_created'].includes(status)) return { bg: '#dcfce7', color: '#166534' };
  if (['failed', 'rejected'].includes(status)) return { bg: '#fee2e2', color: '#991b1b' };
  if (['needs_input', 'needs_review', 'proposed'].includes(status)) return { bg: '#fef3c7', color: '#92400e' };
  return { bg: '#dbeafe', color: '#1e40af' };
};

export default function AiTasks({ supabase, customers = [], notify }) {
  const [requests, setRequests] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [requestResult, taskResult] = await Promise.all([
      supabase.from('ai_inbox_messages')
        .select('id,subject,sender_email,sender_name,received_at,updated_at,status,is_rep_command,submitted_by_id,rep_instruction,original_sender_email,original_sender_name,original_subject,customer_id,command_type,command_status,command_task_id,analysis,error_message,acknowledgement_sent_at,acknowledgement_error')
        .eq('is_rep_command', true).order('received_at', { ascending: false }).limit(300),
      supabase.from('assigned_todos')
        .select('id,title,description,created_by,assigned_to,so_id,customer_id,priority,status,source,created_at,updated_at,completed_at,completed_by,completion_note,bot_payload,bot_status')
        .eq('assigned_to', 'bot-claude').order('created_at', { ascending: false }).limit(500),
    ]);
    if (requestResult.error) notify?.(`AI requests could not load: ${requestResult.error.message}`, 'error');
    if (taskResult.error) notify?.(`Bot tasks could not load: ${taskResult.error.message}`, 'error');
    setRequests(requestResult.data || []);
    setTasks(taskResult.data || []);
    setLoading(false);
  }, [supabase, notify]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase.channel('ai-tasks-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_inbox_messages' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assigned_todos' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, load]);

  const rows = useMemo(() => {
    const requestRows = requests.map(row => {
      const status = row.command_status && row.command_status !== 'none' ? row.command_status : row.status;
      return {
        key: `request:${row.id}`, kind: 'request', id: row.id,
        title: row.rep_instruction || row.original_subject || row.subject || 'Rep email request',
        subtitle: row.original_sender_email ? `Forwarded customer: ${row.original_sender_name || row.original_sender_email}` : `From ${row.sender_name || row.sender_email}`,
        status,
        isOpen: OPEN_REQUEST.has(row.status) || ['proposed', 'approved', 'queued'].includes(row.command_status),
        date: row.updated_at || row.received_at, row,
      };
    });
    const taskRows = tasks.map(row => ({
      key: `task:${row.id}`, kind: 'task', id: row.id, title: row.title || row.id,
      subtitle: row.source === 'ai_email' ? 'Created from rep email' : `Bot task · ${row.source || 'Connect'}`,
      status: row.bot_status || row.status || 'open',
      isOpen: OPEN_BOT.has(row.bot_status) || row.status === 'open',
      date: row.updated_at || row.created_at, row,
    }));
    return [...requestRows, ...taskRows].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [requests, tasks]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      if (filter === 'open' && !row.isOpen) return false;
      if (filter === 'history' && row.isOpen) return false;
      return !q || `${row.id} ${row.title} ${row.subtitle} ${row.status}`.toLowerCase().includes(q);
    });
  }, [rows, filter, search]);
  const selected = rows.find(row => row.key === selectedKey) || visible[0] || null;
  const counts = {
    open: rows.filter(x => x.isOpen).length,
    history: rows.filter(x => !x.isOpen).length,
    review: rows.filter(x => ['needs_review', 'needs_input', 'proposed'].includes(x.status)).length,
  };
  const customerName = id => customers.find(c => c.id === id)?.name || id || 'Unmatched';
  const openInbox = id => {
    const url = new URL(window.location);
    url.search = '';
    url.searchParams.set('pg', 'ai_inbox');
    url.searchParams.set('message', id);
    window.location.href = url.toString();
  };

  if (loading) return <div className="card"><div className="card-body" style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>Loading AI tasks…</div></div>;
  return <div>
    <div className="stats-row" style={{ marginBottom: 14 }}>
      <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => setFilter('open')}><div className="stat-label">Open</div><div className="stat-value" style={{ color: '#2563eb' }}>{counts.open}</div></div>
      <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => setFilter('open')}><div className="stat-label">Needs attention</div><div className="stat-value" style={{ color: '#d97706' }}>{counts.review}</div></div>
      <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => setFilter('history')}><div className="stat-label">Past</div><div className="stat-value" style={{ color: '#166534' }}>{counts.history}</div></div>
      <div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{rows.length}</div></div>
    </div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
      <div className="search-bar" style={{ margin: 0, flex: 1, minWidth: 240 }}><Icon name="search" size={14}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search requests, task IDs, customers, or status…"/></div>
      <select className="form-input" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 150, fontSize: 12 }}><option value="open">Open</option><option value="history">Past tasks</option><option value="all">All</option></select>
      <button className="btn btn-sm btn-secondary" onClick={load}><Icon name="refresh" size={12}/> Refresh</button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px,42%) minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
      <div className="card" style={{ margin: 0, maxHeight: 'calc(100vh - 280px)', overflow: 'auto' }}>
        {visible.length === 0 ? <div className="card-body" style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>No AI tasks in this view.</div> : visible.map(item => {
          const theme = statusTheme(item.status);
          return <button key={item.key} onClick={() => setSelectedKey(item.key)} style={{ width: '100%', display: 'block', textAlign: 'left', border: 'none', borderBottom: '1px solid #e2e8f0', borderLeft: selected?.key === item.key ? '4px solid #2563eb' : '4px solid transparent', padding: '12px 14px', background: selected?.key === item.key ? '#eff6ff' : 'white', cursor: 'pointer' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 10, background: item.kind === 'request' ? '#ede9fe' : '#dbeafe', color: item.kind === 'request' ? '#6d28d9' : '#1e40af', fontWeight: 700 }}>{item.kind === 'request' ? 'EMAIL REQUEST' : 'BOT JOB'}</span>
              <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 10, background: theme.bg, color: theme.color, fontWeight: 700, textTransform: 'uppercase' }}>{String(item.status).replace(/_/g, ' ')}</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94a3b8' }}>{fmtDate(item.date)}</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginTop: 6 }}>{item.title}</div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>{item.id} · {item.subtitle}</div>
          </button>;
        })}
      </div>
      {!selected ? <div className="card"><div className="card-body" style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>Select an AI task.</div></div> :
      <div className="card" style={{ margin: 0 }}>
        <div className="card-header"><div><h2 style={{ margin: 0, fontSize: 16 }}>{selected.title}</h2><div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{selected.id} · {fmtDate(selected.date)}</div></div></div>
        <div className="card-body">
          <div style={{ marginBottom: 12 }}><strong style={{ fontSize: 11 }}>Customer:</strong> <span style={{ fontSize: 12 }}>{customerName(selected.row.customer_id)}</span></div>
          {selected.kind === 'request' ? <>
            <div style={{ padding: 11, borderRadius: 7, background: selected.row.acknowledgement_sent_at ? '#f0fdf4' : selected.row.acknowledgement_error ? '#fef2f2' : '#f8fafc', color: selected.row.acknowledgement_error ? '#991b1b' : '#334155', fontSize: 11, marginBottom: 12 }}>
              {selected.row.acknowledgement_sent_at ? `✓ Rep acknowledgement sent ${fmtDate(selected.row.acknowledgement_sent_at)}` : selected.row.acknowledgement_error ? `Acknowledgement failed: ${selected.row.acknowledgement_error}` : 'Acknowledgement pending'}
            </div>
            <div style={{ marginBottom: 12 }}><div className="form-label">Rep instruction</div><div style={{ whiteSpace: 'pre-wrap', fontSize: 12, padding: 11, background: '#eff6ff', borderRadius: 7 }}>{selected.row.rep_instruction || 'No instruction found'}</div></div>
            {selected.row.analysis?.summary && <div style={{ marginBottom: 12 }}><div className="form-label">AI summary</div><div style={{ fontSize: 12, padding: 11, background: '#faf5ff', borderRadius: 7 }}>{selected.row.analysis.summary}</div></div>}
            {selected.row.error_message && <div style={{ color: '#991b1b', fontSize: 11, marginBottom: 12 }}>{selected.row.error_message}</div>}
            <button className="btn btn-primary" onClick={() => openInbox(selected.id)}>Open in AI Inbox</button>
          </> : <>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>{selected.row.description || 'No description'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 12px', fontSize: 11, padding: 11, background: '#f8fafc', borderRadius: 7, marginBottom: 12 }}>
              <strong>Status</strong><span>{selected.status}</span><strong>Source</strong><span>{selected.row.source || 'Connect'}</span>
              {selected.row.so_id && <><strong>Sales order</strong><span>{selected.row.so_id}</span></>}
              {selected.row.bot_payload?.source_estimate_id && <><strong>Estimate</strong><span>{selected.row.bot_payload.source_estimate_id}</span></>}
              {selected.row.bot_payload?.totals && <><strong>Cart</strong><span>{selected.row.bot_payload.totals.line_count} lines · {selected.row.bot_payload.totals.qty} pieces</span></>}
              {selected.row.completed_at && <><strong>Completed</strong><span>{fmtDate(selected.row.completed_at)}</span></>}
            </div>
            {selected.row.completion_note && <div style={{ fontSize: 11, padding: 10, background: '#f0fdf4', borderRadius: 7, marginBottom: 12 }}>{selected.row.completion_note}</div>}
            {selected.row.bot_payload?.result?.summary && <div style={{ fontSize: 11, padding: 10, background: '#eff6ff', borderRadius: 7, marginBottom: 12 }}>{selected.row.bot_payload.result.summary}</div>}
            {selected.row.bot_payload?.source_inbox_message_id && <button className="btn btn-secondary" onClick={() => openInbox(selected.row.bot_payload.source_inbox_message_id)}>Open source email request</button>}
          </>}
        </div>
      </div>}
    </div>
  </div>;
}
