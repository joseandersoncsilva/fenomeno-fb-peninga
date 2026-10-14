import { createHmac,timingSafeEqual } from 'node:crypto';
import { assertProductionPaymentsAllowed } from './production-guard.js';
const purpose='fbp-prod-status-v1',ttl=7*86400;
function sign(payload) {
 assertProductionPaymentsAllowed();
 return createHmac('sha256',process.env.FBP_PROD_STATUS_SECRET).update(purpose+'.'+payload).digest('base64url');
}
export function issueProductionStatusAccess(reference) {
 if(!/^FBP-[A-F0-9]{12}$/.test(reference||''))throw Error('Invalid order reference');
 const payload=Buffer.from(JSON.stringify({ref:reference,exp:Math.floor(Date.now()/1000)+ttl})).toString('base64url');
 return payload+'.'+sign(payload);
}
export function verifyProductionStatusAccess(reference,token) {
 if(typeof token!=='string'||token.length>300)return false;
 const [payload,sig,...extra]=token.split('.');
 if(extra.length||!payload||!sig)return false;
 const expected=Buffer.from(sign(payload)),actual=Buffer.from(sig);
 if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return false;
 try{
  const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  return data.ref===reference&&Number.isInteger(data.exp)&&data.exp>=Math.floor(Date.now()/1000)&&data.exp<=Math.floor(Date.now()/1000)+ttl;
 }catch{return false;}
}
