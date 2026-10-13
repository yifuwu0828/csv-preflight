import http from 'node:http';
import {readFile,appendFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('./',import.meta.url));
const logDir=path.join(root,'evidence');await mkdir(logDir,{recursive:true});
const html=await readFile(path.join(root,'index.html'),'utf8');
const importMap=html.match(/<script type="importmap">(.*?)<\/script>/s)[1];
const importMapHash=createHash('sha256').update(importMap).digest('base64');
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.onnx':'application/octet-stream','.md':'text/plain'};
const previewPrefix='/preview/csv-preflight';
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  await appendFile(path.join(logDir,'server-requests.jsonl'),JSON.stringify({at:new Date().toISOString(),method:req.method,path:url.pathname,contentLength:req.headers['content-length']??0})+'\n');
  res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-${importMapHash}'; worker-src 'self' blob:; connect-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'`);
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end('Read-only server');return;}
  try{const requested=url.pathname.startsWith(previewPrefix+'/')?url.pathname.slice(previewPrefix.length):url.pathname;const target=path.resolve(root,'.'+decodeURIComponent(requested==='/'?'/index.html':requested));if(!target.startsWith(root)){res.writeHead(403);res.end();return;}const bytes=await readFile(target);res.setHeader('Content-Type',mime[path.extname(target)]??'application/octet-stream');res.writeHead(200);res.end(req.method==='HEAD'?undefined:bytes);}
  catch{res.writeHead(404);res.end('Not found');}
}).listen(8766,'127.0.0.1',()=>console.log('CSV Preflight local prototype: http://127.0.0.1:8766/'));
