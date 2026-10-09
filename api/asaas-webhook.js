// Fail-closed placeholder. Do not accept financial events until database and secret exist.
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 if(req.method!=='POST'){res.status(405).end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));return;}
 res.status(503).end(JSON.stringify({error:'WEBHOOK_NOT_CONFIGURED'}));
}
