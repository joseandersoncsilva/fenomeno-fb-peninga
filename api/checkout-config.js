import { sandboxReady } from './_lib/sandbox.js';
export default function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  return res.status(200).json({enabled:Boolean(sandboxReady()&&process.env.CHECKOUT_TEST_TOKEN),environment:'sandbox',realPaymentsEnabled:false,version:'sandbox-hardening-v1'});
}
