import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';
const workflow=parse(await fs.readFile('.github/workflows/docker-image.yml','utf8'));
const steps=workflow.jobs.deploy.steps;
const script=steps.find(step=>step.name==='Deploy to EC2').with.script;
const start=script.indexOf('restore_previous_containers() {');
const end=script.indexOf("trap 'restore_previous_containers",start);
const restore=script.slice(start,end);
const bash=process.platform==='win32'?'C:\\Program Files\\Git\\bin\\bash.exe':'bash';

test('production regression and heap checks run before image publishing or live replacement',()=>{
  const check=steps.findIndex(step=>step.name==='Check ranking, cache, webhook and storefront regressions');
  assert.ok(check>0&&check<steps.findIndex(step=>step.name==='Push Docker Image'));
  assert.ok(steps[check].run.includes('run-regression-tests.mjs'));
  assert.ok(steps[check].run.includes('--max-old-space-size=256'));
  assert.ok(script.includes('previous_app_image=$(docker inspect'));
  assert.ok(script.indexOf("trap 'restore_previous_containers")<script.indexOf('docker stop --time 30'));
});

function run({code=7,started=true,previous=true,failRestore=false}={}){
  const input=`set -eu\nexec 3>&1\nprevious_app_image=${previous?'old-app':''}\nprevious_worker_image=old-worker\nreplacement_started=${started}\ndocker(){ echo "MOCK_DOCKER $*" >&3; ${failRestore?'return 1;':'return 0;'} }\n${restore}\ntrap 'restore_previous_containers "$?"' EXIT\nexit ${code}\n`;
  return spawnSync(bash,['-c',input],{encoding:'utf8',windowsHide:true,timeout:10000});
}

test('failed startup restores exact previous app and worker images and preserves failure status',()=>{
  const result=run();assert.equal(result.status,7,result.stderr);
  assert.ok(result.stdout.includes('MOCK_DOCKER rm -f shopify-filter-sync-worker shopify-filter-app'));
  assert.ok(result.stdout.includes('old-app'));assert.ok(result.stdout.includes('old-worker node scripts/run-background-worker.mjs'));
  assert.ok(result.stdout.includes('CFP_WORKER_MODE=web'));assert.ok(result.stdout.includes('CFP_WORKER_MODE=worker'));
});

test('successful deployment and failures before replacement never invoke rollback deletion',()=>{
  for(const options of [{code:0},{started:false}]){
    const result=run(options);assert.equal(result.status,options.code??7,result.stderr);assert.ok(!result.stdout.includes('MOCK_DOCKER'));
  }
});

test('missing previous image or failed rollback is reported without masking deployment failure',()=>{
  const missing=run({previous:false});assert.equal(missing.status,7);assert.ok(missing.stdout.includes('no previous app image'));assert.ok(!missing.stdout.includes('MOCK_DOCKER'));
  const failed=run({failRestore:true});assert.equal(failed.status,7);assert.ok(failed.stdout.includes('manual recovery is required'));
});

test('post-startup cleanup failures cannot roll back a healthy app and worker',()=>{
  const start=script.lastIndexOf('# Both processes passed startup checks;');
  assert.ok(start>script.indexOf('if [ "$worker_ready" != true ]'));
  const cleanup=script.slice(start);
  const input=`set -eu\nprevious_app_image=old-app\nprevious_worker_image=old-worker\nreplacement_started=true\ndocker(){ echo "MOCK_DOCKER $*"; return 1; }\n${restore}\ntrap 'restore_previous_containers "$?"' EXIT\n${cleanup}\n`;
  const result=spawnSync(bash,['-c',input],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);
  assert.ok(result.stdout.includes('Deployment completed successfully.'));
  assert.ok(!result.stdout.includes('rm -f shopify-filter-sync-worker'));
});
