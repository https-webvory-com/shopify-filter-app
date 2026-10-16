window.runCsvImportChecks = async () => {
  const results = [], frame = document.createElement('iframe'); frame.style.cssText = 'width:1000px;height:850px;border:0'; document.body.append(frame);
  const delay = ms => new Promise(r => setTimeout(r, ms)), doc = () => frame.contentDocument, win = () => frame.contentWindow;
  const assert = (value, message) => { if (!value) throw Error(message); };
  const wait = async fn => { await delay(50); for (let i = 0; i < 160; i++) { if (fn()) return; await delay(50); } throw Error('Browser condition timed out'); };
  const navigate = async path => { await new Promise(resolve => { frame.onload = resolve; frame.src = path; }); await wait(() => doc().querySelector('input[type=file]')); };
  const click = async text => { const button = [...doc().querySelectorAll('button')].find(b => b.textContent.trim() === text); assert(button && !button.disabled, 'Button unavailable: ' + text); button.click(); await delay(50); };
  const upload = async rows => {
    const escape = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const csv = keys.map(escape).join(',') + '\r\n' + rows.map(r => keys.map(k => escape(r[k])).join(',')).join('\r\n');
    const transfer = new (win().DataTransfer)(); transfer.items.add(new (win().File)([csv], 'other-app.csv', { type: 'text/csv' }));
    doc().querySelector('input[type=file]').files = transfer.files; doc().querySelector('input[type=file]').dispatchEvent(new (win().Event)('change', { bubbles: true })); await delay(50); await click('Next');
  };
  const text = () => doc().querySelector('[aria-label="CSV import results"]')?.textContent || '';
  const test = async (name, fn) => { try { await fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); } };
  const good = { Name: 'Valid rule', Conditions: JSON.stringify([{ Type: 'Boost', Field: 'tags', Value: ['Summer'] }]), CollectionTitles: '["Summer"]', SearchQueries: '["dress"]' };
  const pin = { Id: 'Valid pin', Products: '[{"Id":"1"}]', CollectionTitles: '["Summer"]', SearchQuery: 'dress', AppliedToInstantSearch: 'TRUE', AppliedToSearch: 'TRUE' };
  try {
    for (const scope of ['collection', 'search']) {
      await test(scope + ' merchandising: skipped reasons and original CSV rows remain visible after import', async () => {
        await navigate('/?kind=merch&scope=' + scope); await upload([good, { ...good, Name: 'Malformed condition', Conditions: 'bad json' }, { ...good, Name: 'Bad date', StartDate: 'bad-date' }]);
        assert(text().includes('CSV needs attention') && text().includes('Malformed condition'), 'Preview does not explain bad row');
        await click('Import'); await wait(() => !![...doc().querySelectorAll('button')].find(b => b.textContent === 'Done'));
        assert(text().includes('1 imported, 2 skipped'), 'Incorrect partial summary: ' + text());
        assert(text().includes('CSV row 3') && text().includes('Malformed condition') && text().includes('JSON array') && text().includes('Bad date') && text().includes('date is invalid'), 'Reasons or row names missing');
        await click('Done'); await click('Open importer'); assert(doc().querySelector('input[type=file]') && !text(), 'Stale report on reopening');
      });
      await test(scope + ' pinning: missing product/collection and malformed JSON reasons are expanded automatically', async () => {
        await navigate('/?kind=pins&scope=' + scope); await upload([pin, { ...pin, Id: 'Missing product', Products: '[{"Id":"999"}]' }, { ...pin, Id: 'Bad products JSON', Products: 'broken' }, ...(scope === 'collection' ? [{ ...pin, Id: 'Missing collection', CollectionTitles: '["Gone"]' }] : [])]);
        await click('Start Import'); await wait(() => text().includes(scope === 'collection' ? '1 imported, 3 skipped' : '1 imported, 2 skipped'));
        assert(text().includes('CSV row 3') && text().includes('Missing product') && text().includes('another Shopify store') && text().includes('Bad products JSON'), 'Reasons hidden or incomplete');
        assert(win().toasts.some(t => t.includes('skipped')), 'Completion notification missing');
      });
      await test(scope + ' pinning: failed batch identifies all unconfirmed rows and later batch still imports', async () => {
        await fetch('/__control', { method: 'POST', body: JSON.stringify({ pinFailure: true }) });
        await navigate('/?kind=pins&scope=' + scope); await upload(Array.from({ length: 55 }, (_, i) => ({ ...pin, Id: 'failure-' + i, SearchQuery: 'dress-' + i })));
        await click('Start Import'); await wait(() => text().includes('5 imported, 0 skipped, 50 unconfirmed'));
        assert(text().includes('failure-0') && text().includes('failure-49') && text().includes('HTTP 503') && text().includes('check existing rules'), 'Unconfirmed rows were lost');
        await fetch('/__control', { method: 'POST', body: JSON.stringify({ pinFailure: false }) });
      });
    }
    await test('same-name merchandising condition rows explain why they become one rule', async () => {
      await navigate('/?kind=merch'); await upload([{ ...good, Name: 'Grouped' }, { ...good, Name: 'Grouped' }]); await click('Import'); await wait(() => text().includes('1 imported, 0 skipped'));
      assert(text().includes('rows 2, 3') && text().includes('combined into one rule'), 'Grouping explanation missing');
    });
    await test('partial product matches show warnings without marking the rule as skipped', async () => {
      await navigate('/?kind=pins'); await upload([{ ...pin, Products: '[{"Id":"1"},{"Id":"999"}]' }]); await click('Start Import'); await wait(() => text().includes('1 imported, 0 skipped'));
      assert(text().includes('Warning') && text().includes('1 product(s) were not found'), 'Partial pin warning missing');
    });
    await test('all-skipped file has a visible notification with escaped names and narrow layout', async () => {
      frame.style.width = '375px'; await navigate('/?kind=merch'); await upload([{ ...good, Name: '<img src=x onerror="window.injected=true">', Conditions: 'bad' }]); await click('Import'); await wait(() => !![...doc().querySelectorAll('button')].find(b => b.textContent === 'Done'));
      assert(text().includes('0 imported, 1 skipped') && !win().injected, 'Empty result/XSS handling incorrect');
      assert(doc().documentElement.scrollWidth <= 375, 'Import report overflows mobile frame');
      assert(win().browserErrors.length === 0, 'Unexpected browser error');
    });
    for (const scope of ['collection','search']) await test(`${scope} pin importer retains global CSV positions across 151 rows and skipped entries`, async () => {
      await fetch('/__control', {method:'POST',body:JSON.stringify({pinFailure:false})});
      await navigate('/?kind=pin&scope='+scope);
      await upload(Array.from({length:151}, (_,i)=>({
        Id:'order-'+i, Active:'TRUE', AppliedToInstantSearch:'TRUE', AppliedToSearch:'TRUE',
        Products:i===10 ? 'bad JSON' : '[{"Id":"1"}]',
        CollectionTitles:JSON.stringify(['OrderCollection '+i]), SearchQuery:'order query '+i,
      })));
      await click('Start Import');
      await wait(()=>text().includes('150 imported, 1 skipped'));
      const writes=(await(await fetch('/__pin-writes')).json()).filter(w=>w.ruleType===scope&&(w.name.startsWith('OrderCollection ')||w.name.startsWith('order query ')));
      assert(writes.length===150,'Missing imported rows');
      const groups=new Set(writes.map(w=>w.importOrder.slice(0,-11)));
      assert(groups.size===1,'Concurrent batches did not share one upload group');
      const positions=writes.map(w=>Number(w.importOrder.slice(-10))).sort((a,b)=>a-b);
      assert(JSON.stringify(positions)===JSON.stringify(Array.from({length:151},(_,i)=>i+2).filter(i=>i!==12)),'CSV source positions changed across batch boundaries or skips');
      assert(win().browserErrors.length===0,'Browser error during ordered import');
    });
  } finally { await fetch('/__control', { method: 'POST', body: JSON.stringify({ pinFailure: false, merchFailure: false }) }); frame.remove(); }
  return results;
};
