import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';
const workflow=parse(await fs.readFile('.github/workflows/docker-image.yml','utf8'));
const steps=workflow.jobs.deploy.steps;
const script=steps.find(step=>step.name==='Deploy to EC2').with.script;
const rollout=script.slice(script.indexOf('NGINX_SITE='),script.indexOf('echo "Deployment completed successfully."')+'echo "Deployment completed successfully."'.length);
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';

test('production regression and heap checks run before image publishing or live replacement',()=>{
  const check=steps.findIndex(step=>step.name==='Check ranking, cache, webhook and storefront regressions');
  assert.ok(check>0&&check<steps.findIndex(step=>step.name==='Push Docker Image'));
  assert.ok(steps[check].run.includes('run-regression-tests.mjs'));
  assert.ok(steps[check].run.includes('--max-old-space-size=256'));
  assert.ok(script.includes('previous_app_image=$(docker inspect'));
});

// Simulated server: which ports answer health checks, plus a log of actions.
function run({healthy3006=true,healthy3005After=true,old3005=true,workerReady=true}={}){
  const input=`set -eu
exec 3>&1
ECR_REGISTRY=reg; ECR_REPOSITORY=repo
state=$(mktemp -d)
${old3005?'touch "$state/3005"':''}
sleep(){ :; }
seq(){ echo 1; }
sudo(){ case "$1" in
  cp) return 0;;
  sed) p=\${4##*:}; echo "NGINX \${p%#}" >&3; return 0;;
  nginx) return 0;;
  *) return 0;; esac; }
curl(){ for a in "$@"; do case "$a" in
  *127.0.0.1:3006*) [ -f "$state/3006" ] && return 0 || return 1;;
  *127.0.0.1:3005*) [ -f "$state/3005" ] && return 0 || return 1;;
  https://*) return 0;; esac; done; return 1; }
docker(){ echo "DOCKER $*" >&3
  case "$1" in
    inspect) echo old-image;;
    run) case "$*" in
      *127.0.0.1:3006:3005*) ${healthy3006?'touch "$state/3006"':':'};;
      *" 3005:3005"*) ${healthy3005After?'touch "$state/3005"':':'};;
      esac;;
    stop|rm) case "$*" in *shopify-filter-app-next*) rm -f "$state/3006";; *shopify-filter-app*) rm -f "$state/3005";; esac;;
    exec) ${workerReady?'return 0':'return 1'};;
    ps) echo shopify-filter-sync-worker;;
  esac
  return 0; }
${rollout}
`;
  return spawnSync(bash,['-c',input],{encoding:'utf8',windowsHide:true,timeout:20000});
}
const lines=result=>result.stdout.split('\n').filter(Boolean);
const index=(result,pattern)=>lines(result).findIndex(line=>pattern.test(line));

test('traffic moves to the new version before the serving app is stopped, and ends on 3005',()=>{
  const result=run();assert.equal(result.status,0,result.stderr+result.stdout);
  const spare=index(result,/DOCKER run .*shopify-filter-app-next .*127\.0\.0\.1:3006:3005/);
  const toSpare=index(result,/^NGINX 3006/);
  const stopOld=index(result,/DOCKER stop .*shopify-filter-app$/);
  const main=index(result,/DOCKER run .*--name shopify-filter-app .* 3005:3005/);
  const backTo3005=index(result,/^NGINX 3005/);
  assert.ok(spare>=0&&toSpare>spare&&stopOld>toSpare&&main>stopOld&&backTo3005>main,result.stdout);
  assert.ok(result.stdout.includes('Deployment completed successfully.'));
});

test('a new version that never becomes healthy leaves the serving app and nginx untouched',()=>{
  const result=run({healthy3006:false});assert.notEqual(result.status,0);
  assert.equal(index(result,/DOCKER stop .*shopify-filter-app$/),-1,result.stdout);
  assert.equal(index(result,/^NGINX 3006/),-1);
  assert.ok(index(result,/DOCKER rm -f shopify-filter-app-next/)>=0);
});

test('if the 3005 replacement fails, the previous image is restored on 3005 and nginx returns to it',()=>{
  const result=run({healthy3005After:false});assert.notEqual(result.status,0);
  assert.ok(index(result,/DOCKER run .*--name shopify-filter-app .*old-image/)>=0,result.stdout);
  const out=result.stdout;assert.ok(out.includes('Rollout failed at stage main'));
});

test('a worker that fails its startup check fails the deploy without touching the web app',()=>{
  const result=run({workerReady:false});assert.notEqual(result.status,0);
  assert.ok(index(result,/^NGINX 3005/)>=0);
  assert.ok(result.stdout.includes('Rollout failed at stage worker'));
});
