import { mkdir,cp,rm } from 'node:fs/promises';
// Publish only public assets. Never publish Sandbox test consoles to production.
await rm('public',{recursive:true,force:true});
await mkdir('public',{recursive:true});
for(const path of ['index.html','privacidade.html','fenomeno-fb-peninga.webp','comprar'])
  await cp(path,'public/'+path,{recursive:true});
if(process.env.VERCEL_ENV==='preview' && process.env.VERCEL_GIT_COMMIT_REF==='feat/supabase-asaas-backend'){
 for(const path of ['teste-integracao.html','reconciliar-sandbox.html'])
  await cp(path,'public/'+path,{recursive:true});
}
if(process.env.VERCEL_ENV==='preview' && process.env.VERCEL_GIT_COMMIT_REF==='feat/supabase-asaas-backend'
  && process.env.FBP_SANDBOX_HOMOLOGATION && process.env.FBP_SANDBOX_HOMOLOGATION!=='off'){
 await import('./homologate-sandbox.mjs');
}
