import fs from 'fs';
import path from 'path';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { transformSync } from '@babel/core';

// Exercise the actual estimate render branch with a small stateful editor.
// Only its unrelated props/transport are removed; the preparation guard,
// wrappers, and component lifetime are taken directly from App.js.
const source = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const start = source.indexOf('  function rEst(){');
const end = source.indexOf('    // Filter estimates', start);
const branch = source.slice(start, end).replace('function rEst(){', 'function Preview({eEst,convertingEstimateId}){')
  .replace(/<ActiveOrderEditor[\s\S]*?extractPdfText=\{extractPdfText\}\/>/, '<ActiveOrderEditor key={eEst.id}/>') + 'return null; }';
const compiled = transformSync(branch, { configFile: false, babelrc: false, plugins: [require.resolve('@babel/plugin-transform-react-jsx')] }).code;

test.each(['onSaveNow','onEmergencySave'])('%s waits while the source estimate is converting', async prop => {
  const renderSource = source.slice(start,end);
  const body = renderSource.match(new RegExp(prop+'=\\{(e=>[\\s\\S]*?)\\} on'))[1];
  const ref = {current:'EST-1'}, save = jest.fn().mockResolvedValue(true);
  const callback = Function('conversionInFlight','savENow','return ('+body+')')(ref,save);
  await expect(callback({id:'EST-1'})).resolves.toBe(false);
  expect(save).not.toHaveBeenCalled();
  ref.current = null;
  await expect(callback({id:'EST-1'})).resolves.toBe(true);
  expect(save).toHaveBeenCalledTimes(1);
});

test('conversion preparation and failure keep the estimate editor mounted with its latest local edit', () => {
  let mounts = 0, unmounts = 0;
  function Editor() {
    const [memo, setMemo] = React.useState('older parent snapshot');
    React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return React.createElement('button', {onClick: () => setMemo('latest unsaved memo')}, memo);
  }
  const Boundary = ({children}) => children;
  const Preview = Function('React','ComponentErrorBoundary','ActiveOrderEditor','LazyFallback',compiled+';return Preview;')(React,Boundary,Editor,() => null);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const priorAct = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    const render = busy => act(() => root.render(React.createElement(Preview,{eEst:{id:'EST-1'},convertingEstimateId:busy})));
    render(null);
    act(() => container.querySelector('button').dispatchEvent(new MouseEvent('click',{bubbles:true})));
    render('EST-1');
    expect(container.querySelector('[role="status"]').textContent).toContain('Creating sales order');
    expect(container.querySelector('[inert]')).not.toBeNull();
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    render(null); // preparation failed and returned to the estimate
    expect(container.querySelector('button').textContent).toBe('latest unsaved memo');
    expect(container.querySelector('[inert]')).toBeNull();
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  } finally {
    act(() => root.unmount());
    container.remove();
    global.IS_REACT_ACT_ENVIRONMENT = priorAct;
  }
});
