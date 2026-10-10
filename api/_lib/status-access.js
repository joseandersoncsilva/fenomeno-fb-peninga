import { createHmac, timingSafeEqual } from 'node:crypto';
import { sandboxReady } from './sandbox.js';

const purpose='fbp-status-v1';
const lifetime=7*24*60*60;
function mac(payload) {
 const secret=process.env.CHECKOUT_TEST_TOKEN;
 if(!sandboxReady() || !secret) throw new Error('Sandbox token unavailable');
 return createHmac('sha256',secret).update(purpose+'.'+payload).digest('base64url');
}
export function issueStatusAccess(reference) {
 if(!/^FBP-[A-F0-9]{12}$/.test(reference||'')) throw new Error('Invalid reference');
 const exp=Math.floor(Date.now()/1000)+lifetime;
 const payload=Buffer.from(JSON.stringify({ref:reference,exp})).toString('base64url');
 return payload+'.'+mac(payload);
}
export function verifyStatusAccess(reference,token) {
 if(typeof token!=='string'||token.length>300||!token.includes('.'))return false;
 const [payload,sig,...extra]=token.split('.');
 if(extra.length||!payload||!sig||sig.length>100)return false;
 const expected=Buffer.from(mac(payload)),received=Buffer.from(sig);
 if(expected.length!==received.length||!timingSafeEqual(expected,received))return false;
 try {
  const value=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  return value.ref===reference && Number.isInteger(value.exp) &&
    value.exp>=Math.floor(Date.now()/1000) && value.exp<=Math.floor(Date.now()/1000)+lifetime;
 }catch{return false;}
}
