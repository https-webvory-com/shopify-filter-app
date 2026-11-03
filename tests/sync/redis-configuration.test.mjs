import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function configuration(environment) {
  const script = `import {REDIS_URL,redisConnectionOptions as options} from './app/services/redisConnection.server.js';
    console.log(JSON.stringify({host:options.host,port:options.port,username:options.username,
      password:options.password,tls:!!options.tls,urlPassword:new URL(REDIS_URL).password}));`;
  const run = spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:process.cwd(),encoding:'utf8',env:{...process.env,REDIS_URL:'',REDIS_USERNAME:'',REDIS_PASSWORD:'',...environment},
  });
  assert.equal(run.status,0,run.stderr);
  return JSON.parse(run.stdout.trim());
}

test('default Redis endpoint remains usable without credentials',()=>{
  assert.deepEqual(configuration({}),{host:'184.72.37.227',port:6379,tls:false,urlPassword:''});
});

test('Redis password from server environment reaches direct clients and queues',()=>{
  const actual=configuration({REDIS_PASSWORD:'sample:password@123'});
  assert.equal(actual.password,'sample:password@123');
  assert.equal(decodeURIComponent(actual.urlPassword),'sample:password@123');
});

test('authenticated TLS URL supports Redis username and password',()=>{
  const actual=configuration({REDIS_URL:'rediss://reader:encoded%3Apass@redis.example:6380',REDIS_PASSWORD:'ignored'});
  assert.deepEqual(actual,{host:'redis.example',port:6380,username:'reader',password:'encoded:pass',tls:true,urlPassword:'encoded%3Apass'});
});
