// Exercise the production Caddy routing rules with two loopback HTTP upstreams.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const {once} = require('node:events');
const {setTimeout:delay} = require('node:timers/promises');
const release = require('../desktop-release.json');
const base = path.join(__dirname, '..');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checky-relay-'));
  const calls = [];
  const realLocation = 'https://release-assets.githubusercontent.com/github-production-release-asset/123/file?sig=abc%2Fdef';
  let location = realLocation, secondStatus = 200;
  const github = http.createServer((req,res) => {
    calls.push({url:req.url,headers:req.headers});
    res.writeHead(302, {location, 'Set-Cookie':'bad=1'}).end();
  });
  const cdn = http.createServer((req,res) => {
    calls.push({url:req.url,headers:req.headers});
    res.writeHead(secondStatus, {location:'https://elsewhere.invalid/', 'set-cookie':'bad=2','content-type':'text/html'}).end('fixture');
  });
  let child;
  try {
    const first = await listen(github), second = await listen(cdn);
    const probe = http.createServer();
    const url = await listen(probe);
    await new Promise(resolve => probe.close(resolve));
    const root = path.join(directory, 'desktop-updates'), include = path.join(directory, 'feed.caddy');
    execFileSync(process.execPath, [path.join(base,'scripts/desktop-feed.cjs'),root,include]);
    const manifest = JSON.parse(await fs.readFile(path.join(root,'latest.json')));
    const config = (await fs.readFile(path.join(base,'Caddyfile'),'utf8'))
      .replace(':80 {', url + ' {').replace('auto_https off','admin off\n  auto_https off')
      .replace('root * /srv', 'root * "' + directory + '"').replace('/etc/caddy/desktop-feed*.caddy','"' + include + '"')
      .replace('reverse_proxy https://github.com','reverse_proxy ' + first)
      .replace('reverse_proxy https://release-assets.githubusercontent.com','reverse_proxy ' + second);
    const file = path.join(directory,'Caddyfile');
    await fs.writeFile(file,config);
    child = spawn(process.argv[2], ['run','--config',file,'--adapter','caddyfile'], {stdio:['ignore','ignore','inherit']});
    for (let i=0; i<100; i++) {
      if (child.exitCode !== null) throw Error('Caddy exited during startup');
      if (await fetch(url + '/desktop-updates/latest.json').then(r=>r.ok,()=>false)) break;
      await delay(50);
    }
    const download = () => fetch(url + manifest.downloadUrl + '?private=session-secret', {redirect:'error', headers:{
      Cookie:'sid=session-secret',Authorization:'Bearer session-secret', Referer:'https://app.invalid/session-secret',
      'X-Private':'session-secret','X-Forwarded-For':'198.51.100.101'
    }});
    const response = await download();
    assert.equal(await response.text(),'fixture');
    assert.deepEqual(calls.map(x => x.url), ['/' + release.repository + '/releases/download/' + release.tag + '/' + manifest.fileName, new URL(realLocation).pathname + new URL(realLocation).search]);
    for (const {headers} of calls) {
      assert.doesNotMatch(JSON.stringify(headers), /session-secret|198\.51\.100\.101/);
    }
    assert.equal(response.headers.get('content-type'),'application/octet-stream');
    assert.equal(response.headers.get('content-disposition'),'attachment');
    assert.equal(response.headers.get('set-cookie'),null);
    assert.equal(response.headers.get('location'),null);
    for (location of ['http://release-assets.githubusercontent.com/a','https://release-assets.githubusercontent.com.evil.invalid/a','https://127.0.0.1/private','https://release-assets.githubusercontent.com/other/path']) {
      calls.length=0;
      assert.equal((await download()).status,502);
      assert.equal(calls.length,1);
    }
    location=realLocation; secondStatus=302;
    assert.equal((await download()).status,502);
    calls.length=0;
    assert.equal((await fetch(url+'/desktop-updates/other.exe')).status,404);
    await fs.writeFile(path.join(root,manifest.fileName),'local copy');
    assert.equal(await (await download()).text(),'local copy');
    assert.equal(calls.length,0);
    console.log('PASS private headers and query stay on Base, non-release redirects fail, bundled and unlisted files never call GitHub');
  } finally {
    if (child && child.exitCode === null) { const exit=once(child,'exit'); child.kill(); await exit; }
    github.closeAllConnections(); github.close(); cdn.closeAllConnections(); cdn.close();
    await fs.rm(directory,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
