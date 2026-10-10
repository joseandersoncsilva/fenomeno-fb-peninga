import { mkdir,cp,rm } from 'node:fs/promises';
// Publish only static assets. Server code, SQL, tests and reports are never copied.
await rm('public',{recursive:true,force:true});
await mkdir('public',{recursive:true});
for(const path of ['index.html','privacidade.html','fenomeno-fb-peninga.webp','comprar','teste-integracao.html','reconciliar-sandbox.html'])
  await cp(path,'public/'+path,{recursive:true});
if(process.env.FBP_SANDBOX_HOMOLOGATION && process.env.FBP_SANDBOX_HOMOLOGATION!=='off') {
  await import('./homologate-sandbox.mjs');
}
