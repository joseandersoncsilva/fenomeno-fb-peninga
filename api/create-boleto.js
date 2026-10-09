// No live payments until order persistence, replay protection and webhook are ready.
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 if(req.method!=='POST'){res.status(405).end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));return;}
 res.status(503).end(JSON.stringify({error:'BOLETO_NOT_ENABLED'}));
}
