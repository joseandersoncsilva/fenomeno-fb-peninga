// Deliberately does not read, return, or use the Asaas secret.
export default function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.status(405).end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));return;}
 res.status(200).end(JSON.stringify({integration:'asaas',phase:'preparation',chargesEnabled:false,webhookConfigured:false,storageConfigured:false}));
}
