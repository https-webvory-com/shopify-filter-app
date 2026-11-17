import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';

test('save feedback waits for idle, consumes a result once, and does not replay stale success',async()=>{
 const refs=[],effects=[],calls=[];let cursor=0;
 const react={useRef:value=>refs[cursor++]||(refs[cursor-1]={current:value}),useEffect:callback=>effects.push(callback)};
 const {code}=await transform(await fs.readFile('app/hooks/useCompletedSubmission.js','utf8'),{format:'cjs'});
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:name=>{assert.equal(name,'react');return react;}});
 const render=(result,state)=>{cursor=0;module.exports.useCompletedSubmission(result,state,value=>calls.push(value));for(const effect of effects.splice(0)){effect();effect();}};
 const saved={success:true};
 render(undefined,'idle');render(undefined,'submitting');render(saved,'loading');assert.equal(calls.length,0);
 render(saved,'idle');assert.deepEqual(calls,[saved]);
 render(saved,'idle');render(saved,'submitting');render(saved,'loading');render(saved,'idle');assert.deepEqual(calls,[saved]);
 const failed={error:'Save failed'};render(failed,'loading');assert.equal(calls.length,1);render(failed,'idle');assert.deepEqual(calls,[saved,failed]);
 const next={success:true};render(next,'loading');render(next,'idle');assert.deepEqual(calls,[saved,failed,next]);
});
